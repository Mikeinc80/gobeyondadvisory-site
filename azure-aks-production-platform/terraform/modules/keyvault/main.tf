# Key Vault with Azure RBAC authorization.
#
# RBAC rather than access policies: role assignments are visible in the same
# place as every other Azure permission, support PIM/just-in-time elevation, and
# do not silently grant vault-wide access the way a broad access policy does.

data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "this" {
  name                = var.vault_name
  resource_group_name = var.resource_group_name
  location            = var.location
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = var.sku_name
  tags                = var.tags

  rbac_authorization_enabled = true

  # Recovery controls. Purge protection is irreversible once enabled, which is
  # the point in production: a deleted secret can always be recovered, and an
  # attacker cannot destroy the vault's history.
  soft_delete_retention_days = var.soft_delete_retention_days
  purge_protection_enabled   = var.purge_protection_enabled

  # Only the ARM control plane needs template deployment access; the data plane
  # is reached by workloads through the CSI driver.
  enabled_for_template_deployment = false
  enabled_for_disk_encryption     = false
  enabled_for_deployment          = false

  public_network_access_enabled = var.public_network_access_enabled

  network_acls {
    # Deny by default; the allow lists below are the only way in.
    default_action = "Deny"
    bypass         = "AzureServices"
    ip_rules       = var.allowed_ip_rules
    # The node subnets need a service endpoint to the vault when private
    # endpoints are not in use.
    virtual_network_subnet_ids = var.allowed_subnet_ids
  }
}

resource "azurerm_private_endpoint" "this" {
  count = var.enable_private_endpoint ? 1 : 0

  name                = "pe-${var.vault_name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = var.private_endpoint_subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "psc-${var.vault_name}"
    private_connection_resource_id = azurerm_key_vault.this.id
    subresource_names              = ["vault"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [var.private_dns_zone_id]
  }
}

# Read-only data-plane access for workload identities. "Key Vault Secrets User"
# grants get/list on secrets and nothing else - no writes, no key or certificate
# operations, no management-plane rights.
resource "azurerm_role_assignment" "secrets_user" {
  for_each = toset(var.secret_reader_principal_ids)

  scope                            = azurerm_key_vault.this.id
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = each.value
  skip_service_principal_aad_check = true
}

# Write access for the small set of principals that manage secret material
# (typically a platform-admin group, not a pipeline).
resource "azurerm_role_assignment" "secrets_officer" {
  for_each = toset(var.secret_officer_principal_ids)

  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = each.value
}

# Diagnostic settings: every data-plane operation (including reads) is an audit
# event. Without this, "who read that secret" is unanswerable.
resource "azurerm_monitor_diagnostic_setting" "this" {
  count = var.log_analytics_workspace_id == null ? 0 : 1

  name                       = "diag-${var.vault_name}"
  target_resource_id         = azurerm_key_vault.this.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category = "AuditEvent"
  }

  enabled_log {
    category = "AzurePolicyEvaluationDetails"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}
