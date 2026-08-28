#!/usr/bin/env bash
#
# Creates the Azure Storage account that holds Terraform remote state.
#
# This is the one piece of infrastructure Terraform cannot create for itself:
# the backend has to exist before `terraform init` can run. Keeping it in a
# separate resource group with a delete lock means a careless `terraform destroy`
# in an environment cannot take the state of every environment with it.
#
# Usage:
#   ./bootstrap-remote-state.sh <subscription-id> [location] [resource-group]

set -euo pipefail

SUBSCRIPTION_ID="${1:?usage: bootstrap-remote-state.sh <subscription-id> [location] [resource-group]}"
LOCATION="${2:-uksouth}"
RESOURCE_GROUP="${3:-rg-tfstate-platform}"
CONTAINER="tfstate"

# Deterministic account name: re-running the script targets the same account
# instead of creating a second one.
SUFFIX="$(printf '%s' "${SUBSCRIPTION_ID}" | sha256sum | cut -c1-8)"
STORAGE_ACCOUNT="sttfstate${SUFFIX}"

az account set --subscription "${SUBSCRIPTION_ID}"

echo "==> Resource group ${RESOURCE_GROUP}"
az group create \
  --name "${RESOURCE_GROUP}" \
  --location "${LOCATION}" \
  --tags Workload=platform Environment=shared ManagedBy=bootstrap-script \
  --output none

echo "==> Storage account ${STORAGE_ACCOUNT}"
az storage account create \
  --name "${STORAGE_ACCOUNT}" \
  --resource-group "${RESOURCE_GROUP}" \
  --location "${LOCATION}" \
  --sku Standard_ZRS \
  --kind StorageV2 \
  --min-tls-version TLS1_2 \
  --https-only true \
  --allow-blob-public-access false \
  `# Key-based auth is disabled so the only way in is an Entra ID identity` \
  --allow-shared-key-access false \
  --output none

echo "==> Versioning, soft delete and change feed"
# Versioning turns "someone corrupted state" from an outage into a restore.
az storage account blob-service-properties update \
  --account-name "${STORAGE_ACCOUNT}" \
  --resource-group "${RESOURCE_GROUP}" \
  --enable-versioning true \
  --enable-delete-retention true \
  --delete-retention-days 30 \
  --enable-container-delete-retention true \
  --container-delete-retention-days 30 \
  --output none

echo "==> Container ${CONTAINER}"
az storage container create \
  --name "${CONTAINER}" \
  --account-name "${STORAGE_ACCOUNT}" \
  --auth-mode login \
  --output none

echo "==> Delete lock"
az lock create \
  --name "tfstate-do-not-delete" \
  --lock-type CanNotDelete \
  --resource-group "${RESOURCE_GROUP}" \
  --output none 2>/dev/null || echo "    (lock already present)"

cat <<SUMMARY

Remote state is ready. Write this into each environment's backend.hcl:

  resource_group_name  = "${RESOURCE_GROUP}"
  storage_account_name = "${STORAGE_ACCOUNT}"
  container_name       = "${CONTAINER}"
  key                  = "<env>/platform.tfstate"

Then grant yourself and the CI identity data-plane access (the account has no
usable keys, by design):

  az role assignment create \\
    --role "Storage Blob Data Contributor" \\
    --assignee <object-id> \\
    --scope "\$(az storage account show -n ${STORAGE_ACCOUNT} -g ${RESOURCE_GROUP} --query id -o tsv)"

SUMMARY
