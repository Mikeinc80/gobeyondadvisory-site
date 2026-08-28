# Hub-less, single-VNet segmentation model sized for one environment.
#
# Subnets are separated by trust level rather than by convenience: the AKS node
# subnet, the ingress/application-gateway subnet and the private-endpoint subnet
# each get their own NSG so that a rule change for one cannot silently widen the
# others.

resource "azurerm_virtual_network" "this" {
  name                = "vnet-${var.name_suffix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  address_space       = [var.vnet_address_space]
  tags                = var.tags
}

resource "azurerm_subnet" "aks_system" {
  name                 = "snet-aks-system"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [var.subnet_prefixes.aks_system]
}

resource "azurerm_subnet" "aks_user" {
  name                 = "snet-aks-user"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [var.subnet_prefixes.aks_user]
}

# Dedicated subnet for the ingress data path. Keeping it out of the node subnet
# means the public-facing NSG rules never apply to the nodes themselves.
resource "azurerm_subnet" "ingress" {
  name                 = "snet-ingress"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [var.subnet_prefixes.ingress]
}

# Private endpoints for ACR and Key Vault land here. Network policies must be
# enabled for NSGs to apply to private endpoint NICs.
resource "azurerm_subnet" "private_endpoints" {
  name                              = "snet-private-endpoints"
  resource_group_name               = var.resource_group_name
  virtual_network_name              = azurerm_virtual_network.this.name
  address_prefixes                  = [var.subnet_prefixes.private_endpoints]
  private_endpoint_network_policies = "Enabled"
}

# --- Network security groups -------------------------------------------------
#
# Azure applies a default rule set that already allows intra-VNet traffic and
# denies inbound Internet. These NSGs add the deltas each tier needs; anything
# not listed stays denied by the platform's default rules.

resource "azurerm_network_security_group" "aks" {
  name                = "nsg-aks-${var.name_suffix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

# Only the ingress subnet may open connections to workload ports on the nodes.
resource "azurerm_network_security_rule" "aks_allow_ingress_subnet" {
  name                        = "AllowIngressSubnetToNodes"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.aks.name
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_address_prefix       = var.subnet_prefixes.ingress
  source_port_range           = "*"
  destination_address_prefixes = [
    var.subnet_prefixes.aks_system,
    var.subnet_prefixes.aks_user,
  ]
  destination_port_ranges = ["80", "443", "30000-32767"]
}

# Explicit terminal deny. Redundant with Azure's DenyAllInBound default, but it
# makes the intent auditable and gives a named rule to attribute drops to.
resource "azurerm_network_security_rule" "aks_deny_other_inbound" {
  name                        = "DenyAllOtherInbound"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.aks.name
  priority                    = 4096
  direction                   = "Inbound"
  access                      = "Deny"
  protocol                    = "*"
  source_address_prefix       = "*"
  source_port_range           = "*"
  destination_address_prefix  = "*"
  destination_port_range      = "*"
}

resource "azurerm_network_security_group" "ingress" {
  name                = "nsg-ingress-${var.name_suffix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

# HTTPS from the configured client CIDRs. Defaults to the Internet for the public
# ingress case; environments that front the cluster with Front Door or a
# corporate range narrow this to those prefixes instead.
resource "azurerm_network_security_rule" "ingress_allow_https" {
  name                        = "AllowHttpsInbound"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.ingress.name
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_address_prefixes     = var.allowed_ingress_source_prefixes
  source_port_range           = "*"
  destination_address_prefix  = var.subnet_prefixes.ingress
  destination_port_ranges     = ["443"]
}

# Port 80 exists only to redirect to 443; the ingress controller issues the 308.
resource "azurerm_network_security_rule" "ingress_allow_http_redirect" {
  name                        = "AllowHttpRedirectInbound"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.ingress.name
  priority                    = 110
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_address_prefixes     = var.allowed_ingress_source_prefixes
  source_port_range           = "*"
  destination_address_prefix  = var.subnet_prefixes.ingress
  destination_port_ranges     = ["80"]
}

resource "azurerm_network_security_group" "private_endpoints" {
  name                = "nsg-pe-${var.name_suffix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

# Private endpoints are reachable only from inside the VNet; the default
# AllowVnetInBound rule covers that, so this NSG carries no allow rules of its
# own and exists to make the boundary explicit and monitorable.

resource "azurerm_subnet_network_security_group_association" "aks_system" {
  subnet_id                 = azurerm_subnet.aks_system.id
  network_security_group_id = azurerm_network_security_group.aks.id
}

resource "azurerm_subnet_network_security_group_association" "aks_user" {
  subnet_id                 = azurerm_subnet.aks_user.id
  network_security_group_id = azurerm_network_security_group.aks.id
}

resource "azurerm_subnet_network_security_group_association" "ingress" {
  subnet_id                 = azurerm_subnet.ingress.id
  network_security_group_id = azurerm_network_security_group.ingress.id
}

resource "azurerm_subnet_network_security_group_association" "private_endpoints" {
  subnet_id                 = azurerm_subnet.private_endpoints.id
  network_security_group_id = azurerm_network_security_group.private_endpoints.id
}

# --- Private DNS -------------------------------------------------------------
#
# Required for private-endpoint name resolution: without these zones, in-cluster
# lookups of the ACR and Key Vault FQDNs resolve to public IPs that the firewall
# then blocks, which presents as a confusing timeout rather than a DNS error.

resource "azurerm_private_dns_zone" "acr" {
  count               = var.enable_private_endpoints ? 1 : 0
  name                = "privatelink.azurecr.io"
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_private_dns_zone" "keyvault" {
  count               = var.enable_private_endpoints ? 1 : 0
  name                = "privatelink.vaultcore.azure.net"
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "acr" {
  count                 = var.enable_private_endpoints ? 1 : 0
  name                  = "link-acr-${var.name_suffix}"
  resource_group_name   = var.resource_group_name
  private_dns_zone_name = azurerm_private_dns_zone.acr[0].name
  virtual_network_id    = azurerm_virtual_network.this.id
  tags                  = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "keyvault" {
  count                 = var.enable_private_endpoints ? 1 : 0
  name                  = "link-kv-${var.name_suffix}"
  resource_group_name   = var.resource_group_name
  private_dns_zone_name = azurerm_private_dns_zone.keyvault[0].name
  virtual_network_id    = azurerm_virtual_network.this.id
  tags                  = var.tags
}
