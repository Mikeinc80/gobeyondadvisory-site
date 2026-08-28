# Deployment status

An honest account of what has been verified and what has not.

**Nothing in this repository has been deployed to Azure.** No resource group,
cluster, registry or vault has been created. Every claim below is about local
validation of the code, not about a running system. There are no production
metrics, uptime figures, cost savings or deployment history in this repository,
because there is nothing to report.

Last validated: **2026-08-28**, with `./scripts/validate.sh`.

---

## Locally validated

Every check below was executed and passed on this machine.

| Check | Tool | Result |
| --- | --- | --- |
| Terraform formatting | `terraform fmt -check -recursive` | Pass — no diffs |
| Terraform validity | `terraform validate` × 10 directories (7 modules, 3 environments) | Pass — all valid against azurerm 4.81 |
| Python lint | `ruff check` | Pass — 0 findings |
| Python formatting | `ruff format --check` | Pass — 11 files formatted |
| Unit tests | `pytest` | Pass — **21 tests**, 0.2s |
| Coverage | `pytest --cov --cov-fail-under=85` | Pass — **99%** (132 statements, 1 uncovered) |
| Helm lint | `helm lint` × 3 overlays | Pass — 0 failures |
| Manifest rendering | `helm template` × 3 overlays | Pass — 10 objects rendered per environment |
| Manifest schema | `kubeconform -strict` (Kubernetes 1.31) | Pass — 8 validated, 2 CRDs skipped (SecretProviderClass, ServiceMonitor) |
| Bootstrap manifests | `kubeconform -strict` | Pass — 16 resources valid |
| Prometheus rules | `promtool check rules` | Pass — **13 rules** parsed |
| Grafana dashboard | JSON parse | Pass — 12 panels, 4 rows |
| IaC security | `checkov` (with baseline) | Pass — **60 checks passed, 0 failed** |
| Config security | `trivy config` (with baseline) | Pass — 0 failures across Dockerfile (27 checks), Terraform (123), Kubernetes (355 + 99 rendered) |
| YAML syntax | `yaml.safe_load_all` on every non-template YAML | Pass |
| Shell syntax | `bash -n` | Pass |

Reproduce all of it:

```bash
./scripts/validate.sh
```

### What the tests actually assert

Not just that endpoints return 200:

- Readiness returns **503** before startup and after shutdown, and the lifespan
  is what flips it — the same path Kubernetes depends on.
- The root endpoint reports secret **presence** and never the value
  (`test_root_never_leaks_secret_value`).
- The metrics `path` label collapses unmatched routes to a single series, so a
  scanner cannot explode cardinality.
- A request that raises is still counted as a 500, so the error rate does not
  under-report exactly when it matters.
- Log output is JSON with the fields Container Insights queries.

---

## Validated only as far as tooling allows

| Component | What was checked | What was not |
| --- | --- | --- |
| Dockerfile | `trivy config` (27 checks, 0 failures); syntax and structure | **The image was not built.** The sandbox has no reachable container registry, so `docker build` could not pull `python:3.12-slim-bookworm`. The build is exercised by `app-ci.yml` on GitHub-hosted runners. |
| GitHub Actions workflows | YAML parses; action versions and inputs reviewed against their documented interfaces | No workflow has been executed. The first push will be the first run. |
| Terraform plans | `validate` only | `plan` needs a subscription; it will surface any provider-side argument conflicts that `validate` cannot see. |
| Helm deployment | Templates render and schema-validate | No `helm install` against a live cluster. |
| Prometheus rules | Syntax and PromQL parse via `promtool` | Not evaluated against real series; metric names were taken from kube-state-metrics, cAdvisor and node-exporter conventions. |
| Grafana dashboard | Valid JSON, schema version 39 | Not imported into a Grafana instance. |

---

## What requires an Azure account

Nothing in this list can be verified without a subscription. Approximate effort
for a first end-to-end deployment: **60–90 minutes**.

### Identity and permissions

| Requirement | Why | How to get it |
| --- | --- | --- |
| Subscription with Owner or User Access Administrator | The Terraform creates role assignments | — |
| Entra ID group for cluster admins | `admin_group_object_ids` | `az ad group show --group <name> --query id -o tsv` |
| User-assigned identity for CI + federated credential | OIDC login from GitHub Actions | See below |
| `EncryptionAtHost` feature registered | Host-level node disk encryption | `az feature register --namespace Microsoft.Compute --name EncryptionAtHost` |

Creating the CI identity and federating it:

```bash
az identity create -g rg-platform-shared -n id-github-actions

# One federated credential per GitHub Environment used by the workflows.
# The *-plan environments are the ones terraform-ci.yml targets; the others are
# used by cd.yml.
for env in dev staging production dev-plan staging-plan prod-plan; do
  az identity federated-credential create \
    --name "github-${env}" \
    --identity-name id-github-actions \
    --resource-group rg-platform-shared \
    --issuer "https://token.actions.githubusercontent.com" \
    --subject "repo:<your-org>/azure-aks-production-platform:environment:${env}" \
    --audiences "api://AzureADTokenExchange"
done
```

### Repository configuration

GitHub **Variables** (not secrets — none of these are sensitive):

| Variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | Client ID of `id-github-actions` |
| `AZURE_TENANT_ID` | Your tenant |
| `AZURE_SUBSCRIPTION_ID` | Target subscription |
| `TFSTATE_RESOURCE_GROUP`, `TFSTATE_STORAGE_ACCOUNT`, `TFSTATE_CONTAINER` | From `scripts/bootstrap-remote-state.sh` |
| `PLATFORM_OWNER` | Team name for the `Owner` tag |
| `ACR_NAME_*`, `ACR_LOGIN_SERVER_*` | From `terraform output` per environment |
| `AKS_CLUSTER_*`, `AKS_RESOURCE_GROUP_*` | From `terraform output` per environment |
| `KEY_VAULT_*`, `WORKLOAD_IDENTITY_CLIENT_ID_*` | From `terraform output` per environment |

GitHub **Environments**: `dev`, `staging`, `production` (plus `dev-plan`,
`staging-plan`, `prod-plan` for the Terraform CI job). Configure **required
reviewers on `production`** — that setting is the manual approval gate; without
it, production deploys automatically.

### Placeholders to replace

| Placeholder | Files | Replace with |
| --- | --- | --- |
| `REPLACE_ORG` | `README.md`, `CHANGELOG.md`, `observability/prometheus/alert-rules.yaml` | Your GitHub org or username |
| `REPLACE_ME.azurecr.io` | `charts/platform-api/values.yaml` | Your ACR login server (CD overrides it, but the default should be real) |
| `example.com` hostnames | `charts/platform-api/values-*.yaml` | Your DNS names |
| Placeholder GUIDs | `k8s/bootstrap/rbac.yaml`, `terraform/environments/*/terraform.tfvars.example` | Your Entra ID group object IDs |

```bash
# All of the first one at once:
grep -rl REPLACE_ORG . | xargs sed -i 's/REPLACE_ORG/your-org/g'
```

### Provider lock files

`.terraform.lock.hcl` is **not** committed. The authoring environment had no
route to `registry.terraform.io` (providers came from a local mirror), and a
lock file generated that way records a single platform's hash — committing it
would break `terraform init` on any other machine. After your first init against
the public registry:

```bash
terraform -chdir=terraform/environments/dev init -backend-config=backend.hcl
git add -f terraform/environments/dev/.terraform.lock.hcl
```

Do this for each environment. Committing them is the correct end state — pinning
provider hashes is a supply-chain control.

### Things that will need attention on a first deploy

Predictions, not observed failures — each is a known rough edge of this stack:

1. **Role-assignment propagation.** Entra ID replication can lag, so an
   assignment created in the same apply as its consumer may fail with
   `PrincipalNotFound`. `skip_service_principal_aad_check` covers most cases; a
   re-run of `terraform apply` resolves the rest.
2. **Key Vault firewall vs. the CSI driver.** With private endpoints enabled, the
   private DNS zone must resolve before pods can read secrets. A `403` or a
   timeout in the CSI logs points here first.
3. **The `EncryptionAtHost` feature.** If it is not registered, node-pool
   creation fails outright. Register it before the first apply.
4. **Ingress TLS.** `values-staging.yaml` and `values-prod.yaml` reference a
   `platform-api-tls` secret that nothing creates. Install cert-manager, or sync
   a certificate from Key Vault, before enabling TLS.
5. **`az aks install-cli` in the deploy action** installs `kubelogin`; on a
   runner image that already has it, the step is a no-op.

---

## Not deployed

To be explicit, because portfolio projects often blur this line:

- No Azure resources exist.
- No workflow run has occurred.
- No container image has been built or pushed.
- No cluster has run this workload.
- The cost figures in the README are list-price estimates, not observed spend.
- The RTO/RPO figures in `docs/disaster-recovery.md` are design targets, not
  measured recovery times.
