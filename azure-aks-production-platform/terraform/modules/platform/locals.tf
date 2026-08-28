# Naming and tagging.
#
# Follows the Cloud Adoption Framework shape `<type>-<workload>-<env>-<region>`,
# which keeps resources sortable in the portal and makes a resource's purpose
# readable from its name alone in a bill or an alert.
#
# Two Azure services (ACR, Key Vault) have globally unique names and a restricted
# character set, so they get a deterministic six-character suffix derived from
# the subscription and environment. Deterministic rather than random: a
# `random_string` would make the name depend on state, and losing state would
# then mean losing the ability to reproduce the same names.

data "azurerm_client_config" "current" {}

locals {
  workload = "platform"

  # Short codes keep names inside Azure's tighter length limits (Key Vault: 24).
  env_short = {
    dev        = "dev"
    staging    = "stg"
    production = "prd"
  }[var.environment]

  location_short = var.location_short

  name_suffix = "${local.workload}-${local.env_short}-${local.location_short}"

  unique = substr(
    sha256("${data.azurerm_client_config.current.subscription_id}-${var.environment}-${local.workload}"),
    0,
    6,
  )

  registry_name = "acr${local.workload}${local.env_short}${local.unique}"
  vault_name    = "kv-${local.workload}-${local.env_short}-${local.unique}"

  # Tags are the only reliable way to answer "who owns this and what does it
  # cost" once a subscription has more than a handful of resource groups.
  # ManagedBy/Repository make it obvious that manual portal edits will be
  # reverted by the next apply.
  base_tags = {
    Workload    = local.workload
    Environment = var.environment
    ManagedBy   = "terraform"
    Repository  = var.repository_url
    Owner       = var.owner
    CostCentre  = var.cost_centre
    Criticality = var.criticality
  }

  tags = merge(local.base_tags, var.additional_tags)

  # One workload identity per environment namespace, federated to the service
  # account the Helm chart creates.
  workload_identities = {
    for ns in var.application_namespaces : ns => {
      namespace       = ns
      service_account = var.application_service_account
    }
  }
}
