# Disaster recovery

## Targets

RTO is time to restore service; RPO is acceptable data loss. These are the
platform's design targets, not measured results — nothing here has been drilled
against a live subscription.

| Scenario | RTO | RPO | Recovery |
| --- | --- | --- | --- |
| Bad release | < 5 min | 0 | `helm rollback` (or `--atomic`, automatically) |
| Pod or node failure | Automatic | 0 | Kubernetes reschedules; autoscaler replaces capacity |
| Availability-zone loss | Automatic | 0 | Zone-spread replicas across the two surviving zones |
| Corrupted Terraform state | < 30 min | Last apply | Restore a blob version |
| Accidental resource deletion | < 60 min | 0 | `terraform apply` recreates it |
| Cluster loss | ~60 min | 0 | `terraform apply` + `helm upgrade` from git |
| Region loss | ~4 h | 0 | Rebuild in the paired region |
| Deleted Key Vault secret | < 15 min | 0 | Soft-delete recovery |

RPO is zero almost everywhere for one reason: **this platform is stateless**. The
authoritative state is git (code), Key Vault (secrets) and Terraform state
(resource identity). No cluster holds data that cannot be rebuilt. Adding a
database changes this picture completely — see [Limits](#limits-of-this-model).

## What has to survive

| Asset | Where it lives | Protection |
| --- | --- | --- |
| Infrastructure definition | Git | Remote, branch-protected |
| Application code and chart | Git | Remote, branch-protected |
| Terraform state | Azure Storage, ZRS | Versioning, 30-day soft delete, delete lock, shared-key access disabled |
| Container images | ACR | Zone-redundant (Premium); geo-replicable |
| Secrets | Key Vault | Soft delete (90 days in production) + purge protection |
| Dashboards and alerts | Git + Terraform | Recreated by apply |
| Cluster workloads | Git (Helm values) | Recreated by `helm upgrade` |

Nothing on this list exists only inside a cluster. That is the property that
makes the rebuild path credible.

## Procedures

### Bad release

See [operations-runbook.md → Application rollback](operations-runbook.md#application-rollback).
`--atomic` means most failed deploys have already rolled themselves back.

### Corrupted or lost Terraform state

```bash
# List versions of the state blob
az storage blob list \
  --account-name <state-account> --container-name tfstate \
  --prefix production/platform.tfstate --include v \
  --auth-mode login -o table

# Restore a known-good version
az storage blob copy start \
  --account-name <state-account> --destination-container tfstate \
  --destination-blob production/platform.tfstate \
  --source-uri "https://<state-account>.blob.core.windows.net/tfstate/production/platform.tfstate?versionid=<version>" \
  --auth-mode login

terraform plan   # must show no changes against the live environment
```

If state is unrecoverable, the infrastructure still exists — re-import it rather
than recreating it:

```bash
terraform import module.platform.azurerm_resource_group.this \
  /subscriptions/<sub>/resourceGroups/rg-platform-prd-uks
# ...then each resource, checking `terraform plan` after every import.
```

Budget hours, not minutes, for a full re-import. This is precisely why the state
account has versioning and a delete lock.

### Cluster loss

The cluster is disposable; the environment around it is not.

```bash
cd terraform/environments/prod
terraform apply                        # recreates the cluster in place

az aks get-credentials -g "$(terraform output -raw resource_group_name)" \
  -n "$(terraform output -raw cluster_name)" --overwrite-existing

kubectl apply -f ../../../k8s/bootstrap/namespaces.yaml
kubectl apply -f ../../../k8s/bootstrap/resource-quotas.yaml
kubectl apply -f ../../../k8s/bootstrap/limit-ranges.yaml
kubectl apply -f ../../../k8s/bootstrap/default-deny-networkpolicy.yaml
kubectl apply -f ../../../k8s/bootstrap/rbac.yaml

helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace

# Re-run the CD workflow, or deploy the last known-good tag directly.
helm upgrade --install platform-api charts/platform-api -n production \
  -f charts/platform-api/values-prod.yaml \
  --set image.tag=<last-good-sha> --atomic --wait
```

The one thing that does **not** come back automatically is the ingress public IP.
DNS must be repointed, which is why a low TTL on the record is part of the plan.

### Region loss

Paired region for UK South is UK West. Recovery is a rebuild, not a failover:

1. **Confirm** the outage on the Azure status page — do not fail over on a
   single failed health check.
2. **Provision** in the paired region:
   ```bash
   cd terraform/environments/prod
   terraform apply -var="location=ukwest" -var="location_short=ukw"
   ```
   Note this creates a *new* environment with new names; it does not move the
   old one. Use a separate state key for the DR environment so both can exist.
3. **Images** — pullable only if ACR was geo-replicated
   (`acr_georeplication_locations = ["ukwest"]`). If it was not, the images must
   be rebuilt from source, which adds ~20 minutes.
4. **Secrets** — Key Vault does not replicate across regions. Either restore from
   a backup (`az keyvault secret backup` / `restore`) or re-populate from the
   source of truth.
5. **Deploy** the last known-good tag and repoint DNS.

Honest assessment: ~4 hours, dominated by DNS propagation and secret
re-population. An active-active design with Front Door in front of two regional
clusters would reduce this to minutes, at roughly double the infrastructure cost
and a substantially more complex deployment pipeline. For this platform's
criticality, rebuild-from-code is the right trade — but the trade should be
re-made explicitly for any service with a real revenue impact.

### Key Vault secret recovery

```bash
az keyvault secret list-deleted --vault-name <vault>
az keyvault secret recover --vault-name <vault> --name api-signing-key

# Pre-emptive backups for cross-region recovery
az keyvault secret backup --vault-name <vault> --name api-signing-key \
  --file api-signing-key.bak
```

Soft delete is 7 days in dev/staging and 90 days in production, where purge
protection also prevents an attacker (or a script) from destroying the history.

### Registry loss

Images are rebuildable from git — every tag is a commit SHA:

```bash
git checkout <sha>
docker build -t <acr>.azurecr.io/platform-api:<sha> app/
az acr login -n <acr> && docker push <acr>.azurecr.io/platform-api:<sha>
```

Slower than geo-replication, but it means registry loss is never
unrecoverable.

## Drills

An untested runbook is a guess. Recommended cadence:

| Drill | Frequency | Success criterion |
| --- | --- | --- |
| Rollback in staging | Every release | Previous revision serving in < 5 min |
| Node drain | Monthly | No 5xx during the drain; PDB paces the eviction |
| Terraform state restore | Quarterly | `plan` shows no changes after restore |
| Full environment rebuild (dev) | Quarterly | `destroy` then `apply` + deploy succeeds unattended |
| Region rebuild (staging) | Annually | Service reachable in the paired region within RTO |

## Limits of this model

- **No data tier.** Add a database and RPO stops being zero; you inherit backup
  schedules, point-in-time restore and geo-replication decisions.
- **DNS is manual.** A real failover needs Traffic Manager or Front Door with
  health-probe-driven routing, plus a low record TTL agreed in advance.
- **Nothing here has been drilled.** These are design targets. Until a drill has
  been run against a live subscription, the numbers are estimates and should be
  presented as such.
