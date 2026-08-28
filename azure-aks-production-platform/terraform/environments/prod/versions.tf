terraform {
  required_version = ">= 1.7.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.81"
    }
  }

  # Remote state lives in an Azure Storage account created out-of-band by
  # scripts/bootstrap-remote-state.sh. Values are supplied at init time from
  # backend.hcl (git-ignored) or from -backend-config flags in CI, so no
  # subscription or storage identifiers are committed here.
  #
  #   terraform init -backend-config=backend.hcl
  backend "azurerm" {
    # use_azuread_auth avoids storage account keys entirely: the caller's
    # Entra ID identity needs Storage Blob Data Contributor on the container.
    use_azuread_auth = true
  }
}

provider "azurerm" {
  features {
    key_vault {
      # Deleted vaults stay recoverable; production additionally has purge
      # protection, which makes this non-negotiable there.
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }

    resource_group {
      # Fail loudly if something outside Terraform put a resource in the group,
      # rather than silently destroying it.
      prevent_deletion_if_contains_resources = true
    }
  }

  # Subscription is supplied by ARM_SUBSCRIPTION_ID so the same configuration
  # can target different subscriptions per environment.
  storage_use_azuread = true
}
