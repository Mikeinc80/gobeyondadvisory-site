# Azure Container Registry.
#
# The admin account stays disabled everywhere: image pulls use the kubelet's
# managed identity via an AcrPull role assignment, and CI pushes with a
# federated (OIDC) credential. Neither path involves a stored registry password.

resource "azurerm_container_registry" "this" {
  name                = var.registry_name
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = var.sku
  tags                = var.tags

  # A username/password pair on the registry is a long-lived shared credential
  # with push rights - exactly what managed identity exists to remove.
  admin_enabled = false

  # Premium-only capabilities; guarded so the module still works on Basic/Standard
  # in the cheaper non-production environments.
  public_network_access_enabled = var.sku == "Premium" ? var.public_network_access_enabled : true
  zone_redundancy_enabled       = var.sku == "Premium" ? var.zone_redundant : false

  # Untagged manifests accumulate from every rebuild; ACR garbage-collects them
  # after this many days. Premium only, hence the null on cheaper SKUs.
  retention_policy_in_days = var.sku == "Premium" ? var.untagged_manifest_retention_days : null

  # Content trust: images are signed and consumers can verify provenance.
  trust_policy_enabled = var.sku == "Premium"

  # Nothing in this platform pulls anonymously; every client authenticates with
  # an Entra ID identity so pulls are attributable.
  anonymous_pull_enabled = false

  # Newly pushed images are held in quarantine until they pass ACR's scan, so a
  # known-vulnerable image cannot be pulled even if something references its tag.
  quarantine_policy_enabled = var.sku == "Premium"

  # Dedicated data endpoints give image *data* (not just the API) its own
  # per-region FQDN, which is what makes tight firewall rules possible.
  data_endpoint_enabled = var.sku == "Premium"

  # Geo-replication for multi-region pulls and registry-level DR. Premium only.
  dynamic "georeplications" {
    for_each = var.sku == "Premium" ? toset(var.georeplication_locations) : toset([])
    content {
      location                = georeplications.value
      zone_redundancy_enabled = var.zone_redundant
      tags                    = var.tags
    }
  }

  identity {
    type = "SystemAssigned"
  }
}

# Private endpoint keeps registry traffic on the VNet. Premium-only, so
# non-production environments reach ACR over its public endpoint instead.
resource "azurerm_private_endpoint" "this" {
  count = var.enable_private_endpoint && var.sku == "Premium" ? 1 : 0

  name                = "pe-${var.registry_name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = var.private_endpoint_subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "psc-${var.registry_name}"
    private_connection_resource_id = azurerm_container_registry.this.id
    subresource_names              = ["registry"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [var.private_dns_zone_id]
  }
}

# Pull rights for the cluster's kubelet identity. Scoped to this registry only.
resource "azurerm_role_assignment" "acr_pull" {
  for_each = toset(var.pull_principal_ids)

  scope                = azurerm_container_registry.this.id
  role_definition_name = "AcrPull"
  principal_id         = each.value
  # The identity may not have replicated through Entra ID yet when Terraform
  # creates the assignment immediately after the cluster.
  skip_service_principal_aad_check = true
}

# Push rights for the CI federated identity. Deliberately a separate role from
# the pull path so that compromising a running pod cannot publish images.
resource "azurerm_role_assignment" "acr_push" {
  for_each = toset(var.push_principal_ids)

  scope                            = azurerm_container_registry.this.id
  role_definition_name             = "AcrPush"
  principal_id                     = each.value
  skip_service_principal_aad_check = true
}
