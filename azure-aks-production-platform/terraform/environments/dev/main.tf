# Development environment.
#
# Optimised for cost and iteration speed, not for resilience: Free control-plane
# tier, single-zone nodes, public endpoints for ACR and Key Vault, short log
# retention. Every one of those is a deliberate trade recorded in
# docs/architecture.md, not an oversight.

module "platform" {
  source = "../../modules/platform"

  environment    = "dev"
  location       = var.location
  location_short = var.location_short
  owner          = var.owner
  repository_url = var.repository_url
  criticality    = "low"

  kubernetes_version = var.kubernetes_version

  vnet_address_space = "10.10.0.0/16"
  subnet_prefixes = {
    aks_system        = "10.10.0.0/22"
    aks_user          = "10.10.4.0/22"
    ingress           = "10.10.8.0/24"
    private_endpoints = "10.10.9.0/24"
  }

  # No zonal spread in dev: a single zone is cheaper and an outage here is not
  # an incident.
  availability_zones = ["1"]

  aks_sku_tier = "Free"

  system_node_pool = {
    vm_size         = "Standard_D2ds_v5"
    min_count       = 1
    max_count       = 2
    os_disk_size_gb = 64
  }

  user_node_pool = {
    vm_size         = "Standard_D2ds_v5"
    min_count       = 1
    max_count       = 3
    os_disk_size_gb = 64
  }

  acr_sku                  = "Standard"
  enable_private_endpoints = false

  log_retention_in_days = 30
  # Hard cap: a misbehaving dev workload must not be able to run up a bill.
  log_daily_quota_gb     = 1
  enable_managed_grafana = false

  admin_group_object_ids       = var.admin_group_object_ids
  ci_principal_ids             = var.ci_principal_ids
  secret_officer_principal_ids = var.secret_officer_principal_ids
  alert_email_receivers        = var.alert_email_receivers

  # Noisier thresholds in dev; paging on a dev restart loop is how alert fatigue
  # starts.
  alert_thresholds = {
    node_cpu_percent     = 90
    node_memory_percent  = 90
    node_disk_percent    = 85
    pod_restarts_15m     = 10
    unavailable_replicas = 0
    failed_events_15m    = 20
  }
}
