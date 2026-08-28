# Production environment.
#
# Hardening that is optional elsewhere is mandatory here: zone-redundant node
# pools, Standard control-plane tier with its SLA, private endpoints for ACR and
# Key Vault, purge protection on the vault, an API server restricted to known
# CIDRs and a longer log retention for investigations.

module "platform" {
  source = "../../modules/platform"

  environment    = "production"
  location       = var.location
  location_short = var.location_short
  owner          = var.owner
  repository_url = var.repository_url
  criticality    = "high"

  kubernetes_version = var.kubernetes_version

  vnet_address_space = "10.30.0.0/16"
  subnet_prefixes = {
    aks_system        = "10.30.0.0/22"
    aks_user          = "10.30.4.0/21"
    ingress           = "10.30.12.0/24"
    private_endpoints = "10.30.13.0/24"
  }

  availability_zones = ["1", "2", "3"]

  aks_sku_tier = "Standard"

  system_node_pool = {
    # Three system nodes, one per zone, so losing a zone never leaves CoreDNS
    # or metrics-server without a replica.
    vm_size         = "Standard_D4ds_v5"
    min_count       = 3
    max_count       = 5
    os_disk_size_gb = 128
  }

  user_node_pool = {
    vm_size         = "Standard_D8ds_v5"
    min_count       = 3
    max_count       = 12
    os_disk_size_gb = 256
  }

  acr_sku                  = "Premium"
  enable_private_endpoints = true

  # Longer retention for incident forensics; the daily cap still bounds a
  # runaway logging bug.
  log_retention_in_days  = 90
  log_daily_quota_gb     = 25
  enable_managed_grafana = true

  # Patch-only auto-upgrades: minor upgrades are a planned, tested change here.
  automatic_upgrade_channel = "patch"

  api_server_authorized_ip_ranges = var.api_server_authorized_ip_ranges
  allowed_ingress_source_prefixes = var.allowed_ingress_source_prefixes
  keyvault_allowed_ip_rules       = var.keyvault_allowed_ip_rules

  admin_group_object_ids       = var.admin_group_object_ids
  ci_principal_ids             = var.ci_principal_ids
  secret_officer_principal_ids = var.secret_officer_principal_ids
  alert_email_receivers        = var.alert_email_receivers
  alert_webhook_receivers      = var.alert_webhook_receivers

  # Tighter than the defaults: production should be alerting before saturation
  # becomes user-visible latency.
  alert_thresholds = {
    node_cpu_percent     = 75
    node_memory_percent  = 75
    node_disk_percent    = 75
    pod_restarts_15m     = 2
    unavailable_replicas = 0
    failed_events_15m    = 3
  }
}
