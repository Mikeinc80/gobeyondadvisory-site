# AKS cluster.
#
# Design choices worth defending in review:
#   * Two node pools. The system pool is tainted CriticalAddonsOnly so that a
#     misbehaving workload cannot starve CoreDNS or metrics-server; application
#     pods land on the user pool.
#   * Azure CNI Overlay. Pods get addresses from a separate overlay CIDR, so the
#     VNet only has to be large enough for nodes - node-count growth never
#     becomes an IP-exhaustion incident.
#   * Workload Identity + OIDC issuer. Pods exchange a projected service account
#     token for an Entra ID token; no secret ever exists to leak or rotate.
#   * Entra ID integration with Azure RBAC and local accounts disabled, so
#     kubeconfig access is governed by the same directory as everything else.

resource "azurerm_user_assigned_identity" "cluster" {
  name                = "id-aks-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags
}

# The cluster identity manages resources inside the VNet (load balancers, route
# tables). Network Contributor scoped to the VNet is the documented minimum;
# Contributor on the subscription is the anti-pattern this replaces.
resource "azurerm_role_assignment" "cluster_network_contributor" {
  scope                            = var.vnet_id
  role_definition_name             = "Network Contributor"
  principal_id                     = azurerm_user_assigned_identity.cluster.principal_id
  skip_service_principal_aad_check = true
}

resource "azurerm_kubernetes_cluster" "this" {
  name                = "aks-${var.name_suffix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  dns_prefix          = replace("aks-${var.name_suffix}", "_", "-")
  tags                = var.tags

  kubernetes_version = var.kubernetes_version
  sku_tier           = var.sku_tier

  # Encrypts node temp disks and caches at the host, closing the gap that
  # platform-managed disk encryption alone leaves open. Requires the
  # EncryptionAtHost feature to be registered on the subscription - see
  # docs/operations-runbook.md for the one-off registration command.
  # Customer-managed keys for the OS/data disks are opt-in via
  # disk_encryption_set_id; the platform-managed key is used when it is null.
  disk_encryption_set_id = var.disk_encryption_set_id

  # Node resource group holds AKS-managed infrastructure; naming it explicitly
  # keeps it identifiable next to the platform's own resource groups.
  node_resource_group = "rg-${var.name_suffix}-aks-nodes"

  # --- Identity and access ---------------------------------------------------

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.cluster.id]
  }

  oidc_issuer_enabled       = true
  workload_identity_enabled = true

  # A private cluster puts the API server on a private endpoint. It is off by
  # default because GitHub-hosted runners cannot reach a private API server;
  # turning it on requires a self-hosted runner or a private agent pool, which
  # is a deliberate decision rather than a default (see docs/security.md).
  private_cluster_enabled = var.private_cluster_enabled

  # Certificate-based local admin accounts bypass Entra ID entirely and cannot
  # be attributed to a person, so they are turned off.
  local_account_disabled = true

  azure_active_directory_role_based_access_control {
    # Cluster RBAC is expressed as Azure role assignments, which means access
    # reviews and PIM apply to Kubernetes the same way they apply to Azure.
    azure_rbac_enabled     = true
    tenant_id              = var.tenant_id
    admin_group_object_ids = var.admin_group_object_ids
  }

  # --- Networking ------------------------------------------------------------

  network_profile {
    network_plugin      = "azure"
    network_plugin_mode = "overlay"
    # Cilium enforces NetworkPolicy in eBPF rather than iptables: policy scales
    # with rules rather than with pod count.
    network_policy     = "cilium"
    network_data_plane = "cilium"
    load_balancer_sku  = "standard"
    outbound_type      = var.outbound_type
    pod_cidr           = var.pod_cidr
    service_cidr       = var.service_cidr
    dns_service_ip     = var.dns_service_ip
  }

  # An API server reachable only from listed CIDRs. Empty means "any", which is
  # acceptable in dev but flagged in docs/security.md as a production gap.
  dynamic "api_server_access_profile" {
    for_each = length(var.api_server_authorized_ip_ranges) > 0 ? [1] : []
    content {
      authorized_ip_ranges = var.api_server_authorized_ip_ranges
    }
  }

  # --- Node pools ------------------------------------------------------------

  default_node_pool {
    name                 = "system"
    vm_size              = var.system_node_pool.vm_size
    vnet_subnet_id       = var.system_subnet_id
    zones                = var.availability_zones
    orchestrator_version = var.kubernetes_version
    max_pods             = 50

    auto_scaling_enabled = true
    min_count            = var.system_node_pool.min_count
    max_count            = var.system_node_pool.max_count

    # Ephemeral OS disks are faster and cost nothing extra; nodes are cattle, so
    # losing the OS disk with the node is not a data-loss event.
    os_disk_type    = "Ephemeral"
    os_disk_size_gb = var.system_node_pool.os_disk_size_gb

    only_critical_addons_enabled = true
    host_encryption_enabled      = var.host_encryption_enabled

    # A hardened host OS with automatic security patching between image upgrades.
    os_sku = "AzureLinux"
    upgrade_settings {
      max_surge = "33%"
    }

    tags = var.tags
  }

  auto_scaler_profile {
    # Scale down only after a node has been genuinely idle, so that bursty
    # traffic does not cause a scale-up/scale-down oscillation.
    scale_down_unneeded              = "10m"
    scale_down_utilization_threshold = "0.5"
    expander                         = "least-waste"
    skip_nodes_with_local_storage    = true
    skip_nodes_with_system_pods      = true
  }

  # --- Platform add-ons ------------------------------------------------------

  oms_agent {
    log_analytics_workspace_id      = var.log_analytics_workspace_id
    msi_auth_for_monitoring_enabled = true
  }

  # Mounts Key Vault secrets as files (and optionally env vars) using the pod's
  # workload identity. Rotation picks up new versions without a redeploy.
  key_vault_secrets_provider {
    secret_rotation_enabled  = true
    secret_rotation_interval = "5m"
  }

  # Managed Prometheus scraping, written to the Azure Monitor workspace.
  dynamic "monitor_metrics" {
    for_each = var.monitor_workspace_id == null ? [] : [1]
    content {
      annotations_allowed = null
      labels_allowed      = null
    }
  }

  # Baseline pod-security and image policies enforced in-cluster by Gatekeeper.
  azure_policy_enabled = var.azure_policy_enabled

  # Rolling node-image upgrades during a defined window rather than whenever
  # Microsoft ships an image.
  automatic_upgrade_channel = var.automatic_upgrade_channel
  node_os_upgrade_channel   = "NodeImage"

  maintenance_window_auto_upgrade {
    frequency   = "Weekly"
    interval    = 1
    day_of_week = var.maintenance_day
    start_time  = var.maintenance_start_time
    utc_offset  = "+00:00"
    duration    = 4
  }

  lifecycle {
    ignore_changes = [
      # The autoscaler owns the live node count; Terraform must not fight it.
      default_node_pool[0].node_count,
      # Patch versions move under the auto-upgrade channel.
      kubernetes_version,
    ]
  }
}

# Application workloads. Kept separate from the cluster resource so the pool can
# be resized, re-imaged or replaced without touching the control plane.
resource "azurerm_kubernetes_cluster_node_pool" "user" {
  name                  = "user"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.this.id
  vm_size               = var.user_node_pool.vm_size
  vnet_subnet_id        = var.user_subnet_id
  zones                 = var.availability_zones
  orchestrator_version  = var.kubernetes_version
  max_pods              = 100
  mode                  = "User"
  os_sku                = "AzureLinux"
  tags                  = var.tags

  auto_scaling_enabled = true
  min_count            = var.user_node_pool.min_count
  max_count            = var.user_node_pool.max_count

  os_disk_type            = "Ephemeral"
  os_disk_size_gb         = var.user_node_pool.os_disk_size_gb
  host_encryption_enabled = var.host_encryption_enabled

  upgrade_settings {
    max_surge = "33%"
  }

  lifecycle {
    ignore_changes = [node_count, orchestrator_version]
  }
}

# --- Workload identity -------------------------------------------------------
#
# One identity per environment namespace. The federated credential binds it to a
# specific namespace/service-account pair, so a pod in `dev` cannot assume the
# `production` identity even if it forges the service account name.

resource "azurerm_user_assigned_identity" "workload" {
  for_each = var.workload_identities

  name                = "id-wi-${each.key}-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags
}

resource "azurerm_federated_identity_credential" "workload" {
  for_each = var.workload_identities

  name                = "fic-${each.key}"
  resource_group_name = var.resource_group_name
  parent_id           = azurerm_user_assigned_identity.workload[each.key].id
  audience            = ["api://AzureADTokenExchange"]
  issuer              = azurerm_kubernetes_cluster.this.oidc_issuer_url
  subject             = "system:serviceaccount:${each.value.namespace}:${each.value.service_account}"
}

# --- Cluster-scoped diagnostics ---------------------------------------------

resource "azurerm_monitor_diagnostic_setting" "aks" {
  name                       = "diag-aks-${var.name_suffix}"
  target_resource_id         = azurerm_kubernetes_cluster.this.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  # Control-plane logs. kube-audit is the expensive one, so it is opt-in:
  # kube-audit-admin covers mutating calls at a fraction of the volume.
  dynamic "enabled_log" {
    for_each = toset(var.control_plane_log_categories)
    content {
      category = enabled_log.value
    }
  }

  enabled_metric {
    category = "AllMetrics"
  }
}
