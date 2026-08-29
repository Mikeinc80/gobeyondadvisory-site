# Dev environment validation

How to deploy **only** the dev environment to a real subscription, prove each
component works, capture evidence, and destroy everything again — at the lowest
cost that still validates the design.

Nothing in this repository has been deployed yet. This document is the
procedure; [DEPLOYMENT_STATUS.md](../DEPLOYMENT_STATUS.md) is where results go
once it has actually been run.

## Cost expectation

Dev is already the cheap environment: Free control-plane tier (no hourly charge),
one availability zone, Standard ACR, a 1 GB/day log cap and no Managed Grafana.
What remains is mostly node compute.

| Item | Rate (UK South list, approximate) | 4-hour run |
| --- | --- | --- |
| 2 × `Standard_D2ds_v5` nodes | ~$0.113/hr each | ~$0.90 |
| AKS control plane (Free tier) | $0 | $0 |
| Standard ACR | ~$0.028/hr | ~$0.11 |
| Standard Load Balancer + public IP (ingress) | ~$0.030/hr | ~$0.12 |
| Log Analytics ingestion | ~$2.30/GB, capped at 1 GB/day | < $1 |
| Key Vault, Azure Monitor workspace, DCR | per-operation, negligible at this volume | < $0.10 |

**A four-hour validation run costs roughly $2–3.** Left running, dev is on the
order of **$150–200/month**, which is why the teardown section matters more than
the deployment one.

Confirm against the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/)
for your region — these are list prices at the time of writing, not a quote.

### Cutting it further

The dev root exposes sizing as variables specifically for this:

```hcl
# terraform.tfvars - smallest cluster that still proves the design
user_node_pool = {
  vm_size         = "Standard_D2ds_v5"
  min_count       = 1
  max_count       = 1   # no autoscaling headroom; see the HPA note below
  os_disk_size_gb = 64
}

# Skip Azure Monitor metric ingestion if this run is only proving the
# infrastructure and deployment path.
enable_managed_prometheus = false
```

Two consequences to be aware of before setting these:

- `max_count = 1` means the **cluster autoscaler cannot add nodes**, so the HPA
  scale-out check below will show pods `Pending` rather than scheduling. That is
  still a valid observation (it proves the HPA acted), but if you want to see
  scale-out complete, leave `max_count` at 3.
- `enable_managed_prometheus = false` skips checklist section 10.

**Pausing between sessions costs nothing to set up and stops node billing:**

```bash
az aks stop  --name <cluster> --resource-group <rg>   # deallocates the nodes
az aks start --name <cluster> --resource-group <rg>   # ~5 minutes to return
```

---

## Prerequisites

```bash
az login
az account set --subscription "<subscription-id>"
az account show --query "{name:name, id:id, tenant:tenantId}" -o table

# You need Owner or User Access Administrator: the Terraform creates role
# assignments, which Contributor cannot do.
az role assignment list --assignee "$(az ad signed-in-user show --query id -o tsv)" \
  --scope "/subscriptions/$(az account show --query id -o tsv)" \
  --query "[].roleDefinitionName" -o tsv

# One-off, and node-pool creation fails without it. Registration takes minutes.
az feature register --namespace Microsoft.Compute --name EncryptionAtHost
az feature show --namespace Microsoft.Compute --name EncryptionAtHost \
  --query properties.state -o tsv        # wait for "Registered"
az provider register --namespace Microsoft.Compute
```

Local tooling: `terraform >= 1.7`, `kubectl >= 1.30`, `helm >= 3.14`, `docker`,
`az >= 2.60`, `kubelogin`.

---

## Step 1 — Remote state

```bash
cd azure-aks-production-platform
./scripts/bootstrap-remote-state.sh "$(az account show --query id -o tsv)" uksouth
```

The script prints the `backend.hcl` values. Grant yourself data-plane access —
the storage account has shared-key access disabled by design, so Entra ID is the
only way in:

```bash
STATE_RG=rg-tfstate-platform
STATE_SA=$(az storage account list -g "$STATE_RG" --query "[0].name" -o tsv)

az role assignment create \
  --role "Storage Blob Data Contributor" \
  --assignee "$(az ad signed-in-user show --query id -o tsv)" \
  --scope "$(az storage account show -n "$STATE_SA" -g "$STATE_RG" --query id -o tsv)"
```

Role assignments take a minute or two to propagate; a `403` on the next step
usually means you were just too quick.

## Step 2 — Configure the dev environment

```bash
cd terraform/environments/dev
cp backend.hcl.example backend.hcl
cp terraform.tfvars.example terraform.tfvars
```

Edit `backend.hcl` with the values from step 1, then `terraform.tfvars`:

```bash
# An admin group is required for cluster access: local accounts are disabled, so
# without it nobody can authenticate to the API server.
az ad group create --display-name "aks-platform-admins" --mail-nickname "aks-platform-admins"
ADMIN_GROUP=$(az ad group show --group "aks-platform-admins" --query id -o tsv)
az ad group member add --group "$ADMIN_GROUP" \
  --member-id "$(az ad signed-in-user show --query id -o tsv)"

# Your own object ID doubles as the secret officer for this validation run.
ME=$(az ad signed-in-user show --query id -o tsv)

echo "admin_group_object_ids       = [\"$ADMIN_GROUP\"]"
echo "secret_officer_principal_ids = [\"$ME\"]"
```

Put those into `terraform.tfvars`, and set `ci_principal_ids = []` for now — no
GitHub Actions identity is needed to validate the infrastructure by hand.

## Step 3 — Apply

```bash
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan          # read it; ~60 resources for a clean dev apply
terraform apply tfplan              # 12-18 minutes, dominated by cluster creation
```

If the apply fails part-way, re-run it before investigating: the most common
cause is Entra ID role-assignment propagation, which resolves on a second pass.

## Step 4 — Connect

```bash
export RG=$(terraform output -raw resource_group_name)
export CLUSTER=$(terraform output -raw cluster_name)
export ACR=$(terraform output -raw acr_name)
export ACR_SERVER=$(terraform output -raw acr_login_server)
export KV=$(terraform output -raw key_vault_name)
export WI_CLIENT_ID=$(terraform output -json workload_identity_client_ids | jq -r .dev)
export TENANT=$(terraform output -raw tenant_id)

az aks get-credentials -g "$RG" -n "$CLUSTER" --overwrite-existing
kubelogin convert-kubeconfig -l azurecli
kubectl get nodes
```

## Step 5 — Bootstrap the cluster

```bash
cd ../../..                          # repository root

kubectl apply -f k8s/bootstrap/namespaces.yaml
kubectl apply -f k8s/bootstrap/resource-quotas.yaml
kubectl apply -f k8s/bootstrap/limit-ranges.yaml
# Apply default-deny before any workload: adding it to a namespace with live
# traffic breaks anything that has no explicit allow rule.
kubectl apply -f k8s/bootstrap/default-deny-networkpolicy.yaml

helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.replicaCount=1 \
  --wait --timeout 5m
```

`k8s/bootstrap/rbac.yaml` is deliberately **not** applied here: it contains
placeholder group object IDs. Replace them with real groups before applying it,
or skip it for a solo validation run.

## Step 6 — Seed a secret and build the image

```bash
az keyvault secret set --vault-name "$KV" --name api-signing-key \
  --value "$(openssl rand -hex 32)" --output none
# Generated locally and never leaves your machine or the vault. Nothing in this
# repository stores a secret value.

az acr login --name "$ACR"
TAG=$(git rev-parse --short=7 HEAD)
docker build --build-arg APP_REVISION="$TAG" -t "$ACR_SERVER/platform-api:$TAG" app/
docker push "$ACR_SERVER/platform-api:$TAG"
```

## Step 7 — Deploy

```bash
helm upgrade --install platform-api charts/platform-api \
  --namespace dev \
  -f charts/platform-api/values-dev.yaml \
  --set image.repository="$ACR_SERVER/platform-api" \
  --set image.tag="$TAG" \
  --set serviceAccount.workloadIdentityClientId="$WI_CLIENT_ID" \
  --set keyVault.enabled=true \
  --set keyVault.name="$KV" \
  --set keyVault.tenantId="$TENANT" \
  --atomic --wait --timeout 5m
```

`values-dev.yaml` disables Key Vault by default; the `--set` flags above turn it
on so the workload-identity path is exercised, which is the single most
interesting thing to validate.

---

## Validation checklist

Work top to bottom. Each item states what to run and what a pass looks like.

### 1. Terraform apply

- [ ] `terraform apply` completes without error
- [ ] `terraform plan` immediately afterwards reports **no changes** — proves the
      configuration is convergent and nothing drifts on the first pass
- [ ] `terraform output` returns every expected value (cluster, ACR, Key Vault,
      workload identity client IDs)
- [ ] Every resource carries the standard tags:
      `az resource list -g "$RG" --query "[?tags.ManagedBy!='terraform'].name" -o tsv`
      returns nothing

### 2. AKS cluster health

- [ ] `kubectl get nodes` shows all nodes `Ready`
- [ ] Two node pools exist, and the system pool is tainted:
      `kubectl get nodes -L kubernetes.azure.com/mode` and
      `kubectl describe node <system-node> | grep Taints` shows `CriticalAddonsOnly`
- [ ] Core add-ons are running: `kubectl get pods -n kube-system` (CoreDNS,
      metrics-server, `azure-wi-webhook`, `secrets-store-csi-driver`, `ama-*`)
- [ ] `kubectl auth can-i --list -n dev` succeeds — i.e. Entra ID auth works with
      local accounts disabled
- [ ] Local accounts really are disabled:
      `az aks show -g "$RG" -n "$CLUSTER" --query disableLocalAccounts` is `true`
      (and `az aks get-credentials --admin` fails)

### 3. ACR push and pull

- [ ] `docker push` to the registry succeeds after `az acr login` — no registry
      password was used anywhere
- [ ] Admin account is off: `az acr show -n "$ACR" --query adminUserEnabled` is `false`
- [ ] The tag is listed: `az acr repository show-tags -n "$ACR" --repository platform-api -o table`
- [ ] The cluster pulled it with its kubelet identity:
      `kubectl describe pod -n dev -l app.kubernetes.io/name=platform-api | grep -A2 Pulled`
      shows a successful pull and **no** `imagePullSecrets` on the pod

### 4. Workload identity

- [ ] The service account carries the client-id annotation and the use label:
      `kubectl get sa platform-api -n dev -o yaml`
- [ ] The webhook injected the federated token into the pod:
      `kubectl exec -n dev deploy/platform-api -- ls /var/run/secrets/azure/tokens/`
      lists `azure-identity-token`
- [ ] Federation is bound to this namespace and service account:
      `az identity federated-credential list --identity-name id-wi-dev-platform-dev-uks -g "$RG" --query "[].subject" -o tsv`
      returns `system:serviceaccount:dev:platform-api`

### 5. Key Vault integration

- [ ] The CSI driver mounted the secret:
      `kubectl exec -n dev deploy/platform-api -- ls /mnt/secrets-store/` lists
      `api-signing-key`
- [ ] The application sees it, and reports **presence only**:
      `curl -s localhost:8080/ | jq .secret_bound` is `true` and the response
      contains no secret value
- [ ] The read is audited:
      `az monitor log-analytics query -w "$(az monitor log-analytics workspace show -g "$RG" -n "$(terraform -chdir=terraform/environments/dev output -raw log_analytics_workspace_name)" --query customerId -o tsv)" --analytics-query "AzureDiagnostics | where ResourceType == 'VAULTS' and OperationName == 'SecretGet' | take 5"`
      returns rows (allow ~10 minutes for first ingestion)
- [ ] Least privilege holds: the workload identity has `Key Vault Secrets User`
      and nothing else —
      `az role assignment list --assignee "$WI_CLIENT_ID" --all --query "[].roleDefinitionName" -o tsv`

### 6. Helm deployment

- [ ] `helm list -n dev` shows the release `deployed`
- [ ] `helm history platform-api -n dev` records the revision
- [ ] Every expected object exists:
      `kubectl get deploy,svc,ingress,cm,hpa,netpol,sa,secretproviderclass -n dev`
- [ ] The PDB is absent in dev (single replica — `values-dev.yaml` disables it on
      purpose): `kubectl get pdb -n dev` returns nothing
- [ ] Pod security holds: `kubectl get pod -n dev -o jsonpath='{.items[0].spec.securityContext}'`
      shows `runAsNonRoot: true`, and
      `kubectl exec -n dev deploy/platform-api -- id -u` returns `10001`
- [ ] Read-only root filesystem is enforced:
      `kubectl exec -n dev deploy/platform-api -- touch /root-test` fails, while
      `touch /tmp/ok` succeeds

### 7. Probes and lifecycle

- [ ] `kubectl port-forward -n dev svc/platform-api 8080:80` then:
      - `curl -s localhost:8080/health` returns `{"status":"ok"}`
      - `curl -s localhost:8080/ready` returns `200` with `"ready":true`
      - `curl -s localhost:8080/ | jq` reports the environment `dev` and the
        revision equal to `$TAG`
- [ ] The readiness gate actually gates traffic — during a rollout,
      `kubectl get endpoints platform-api -n dev -w` shows the new pod appear only
      after it is ready
- [ ] Drain works: `kubectl delete pod -n dev -l app.kubernetes.io/name=platform-api`
      while a `curl` loop runs against the port-forward shows no connection errors
      once a second replica exists (`kubectl scale deploy/platform-api -n dev --replicas=2` first)

### 8. HPA

- [ ] The HPA reports real metrics, not `<unknown>`:
      `kubectl get hpa platform-api -n dev` shows `cpu: <n>%/80%`
- [ ] It scales out under load:
      ```bash
      kubectl run load --rm -it --restart=Never -n dev --image=busybox:1.36 -- \
        sh -c 'while true; do wget -q -O- http://platform-api/ >/dev/null; done'
      ```
      then watch `kubectl get hpa,pods -n dev -w`. Expect replicas to rise within
      a few minutes.
      **Note:** the namespace has a default-deny NetworkPolicy, so this load pod
      has no egress. Either run the load from a port-forward on your machine
      (`while true; do curl -s localhost:8080/ >/dev/null; done`) or temporarily
      label the pod and add an allow rule. The port-forward approach is simpler
      and proves the same thing.
- [ ] It scales back in after the load stops — allow the 300s stabilisation window
- [ ] With `user_node_pool.max_count = 1`, expect `Pending` pods instead of
      scale-out: that still proves the HPA acted, and
      `kubectl describe pod <pending>` should say `Insufficient cpu`

### 9. Network policy

- [ ] Default-deny is in force: a shell pod in `dev` cannot reach the service
      ```bash
      kubectl run np-test --rm -it --restart=Never -n dev --image=busybox:1.36 -- \
        wget -T 5 -q -O- http://platform-api/   # expect a timeout
      ```
- [ ] But the ingress controller can — `curl` through the ingress public IP works
      (see below)
- [ ] IMDS is blocked from the workload:
      `kubectl exec -n dev deploy/platform-api -- wget -T 5 -q -O- http://169.254.169.254/metadata/instance`
      times out

### 10. Prometheus and Grafana

Skip if `enable_managed_prometheus = false`.

- [ ] The metrics endpoint serves exposition:
      `curl -s localhost:8080/metrics | grep -E 'http_requests_total|app_ready'`
- [ ] The scrape config is applied and the add-on picked it up:
      ```bash
      kubectl apply -f observability/prometheus/scrape-config.yaml
      kubectl rollout restart deployment ama-metrics -n kube-system
      kubectl logs -n kube-system -l rsName=ama-metrics --tail=50 | grep -i platform-api
      ```
- [ ] The Data Collection Rule is associated with the cluster:
      `az monitor data-collection rule association list --resource "$(az aks show -g "$RG" -n "$CLUSTER" --query id -o tsv)" -o table`
- [ ] Metrics arrive in the workspace — query `app_ready` in the Azure portal
      under Monitor → Metrics → your Azure Monitor workspace (allow ~15 minutes)
- [ ] Grafana: dev does not provision it. To view the dashboard, either set
      `enable_managed_grafana = true` for this run, or import
      `observability/grafana/platform-overview-dashboard.json` into a local
      Grafana pointed at the workspace

### 11. Logs and alerts

- [ ] Container Insights has the structured logs:
      ```bash
      az monitor log-analytics query \
        -w "$(az monitor log-analytics workspace show -g "$RG" -n log-platform-dev-uks --query customerId -o tsv)" \
        --analytics-query "ContainerLogV2 | where PodNamespace == 'dev' | take 5" -o table
      ```
- [ ] Alert rules exist and are enabled:
      `az monitor metrics alert list -g "$RG" -o table` and
      `az monitor scheduled-query list -g "$RG" -o table`
- [ ] The action group is wired: `az monitor action-group list -g "$RG" -o table`

### 12. Ingress

- [ ] The controller has a public IP:
      `kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}'`
- [ ] The route works with a Host header (no DNS record needed):
      ```bash
      IP=$(kubectl get svc -n ingress-nginx ingress-nginx-controller \
        -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
      curl -s -H "Host: platform-api.dev.example.com" "http://$IP/" | jq
      ```

### 13. Rollback

- [ ] Deploy a deliberately broken revision and confirm `--atomic` protects you:
      ```bash
      helm upgrade platform-api charts/platform-api -n dev \
        -f charts/platform-api/values-dev.yaml \
        --set image.repository="$ACR_SERVER/platform-api" \
        --set image.tag=does-not-exist \
        --set serviceAccount.workloadIdentityClientId="$WI_CLIENT_ID" \
        --atomic --wait --timeout 2m
      ```
      Expect the upgrade to **fail and roll itself back**.
- [ ] Service stayed up throughout: `curl` through the port-forward still returns
      the previous revision
- [ ] `helm history platform-api -n dev` shows the failed revision followed by a
      rollback
- [ ] An explicit rollback also works: `helm rollback platform-api -n dev --wait`

### 14. GitHub Actions

CI runs without any Azure access, so validate that first:

- [ ] Push the branch; `Application CI` and `Security` both pass on GitHub-hosted
      runners with no configuration
- [ ] `Terraform CI` fmt/validate passes; the `plan` job **skips** until
      `AZURE_CLIENT_ID` is set (`if: vars.AZURE_CLIENT_ID != ''`)

To validate the deployment path end-to-end, create the CI identity and federate it:

```bash
az identity create -g "$RG" -n id-github-actions
CI_CLIENT_ID=$(az identity show -g "$RG" -n id-github-actions --query clientId -o tsv)
CI_PRINCIPAL=$(az identity show -g "$RG" -n id-github-actions --query principalId -o tsv)

for env in dev dev-plan; do
  az identity federated-credential create \
    --name "github-$env" --identity-name id-github-actions --resource-group "$RG" \
    --issuer "https://token.actions.githubusercontent.com" \
    --subject "repo:Mikeinc80/azure-aks-production-platform:environment:$env" \
    --audiences "api://AzureADTokenExchange"
done

# AcrPush for the build job, and cluster access for the deploy job.
az role assignment create --role AcrPush --assignee "$CI_PRINCIPAL" \
  --scope "$(az acr show -n "$ACR" --query id -o tsv)"
az role assignment create --role "Azure Kubernetes Service RBAC Writer" \
  --assignee "$CI_PRINCIPAL" \
  --scope "$(az aks show -g "$RG" -n "$CLUSTER" --query id -o tsv)/namespaces/dev"
az role assignment create --role "Azure Kubernetes Service Cluster User Role" \
  --assignee "$CI_PRINCIPAL" --scope "$(az aks show -g "$RG" -n "$CLUSTER" --query id -o tsv)"
```

Then add the repository variables listed in
[DEPLOYMENT_STATUS.md](../DEPLOYMENT_STATUS.md#repository-configuration), create
the `dev` and `dev-plan` GitHub Environments, and:

- [ ] `Terraform CI` plan job runs and posts a plan to the pull request
- [ ] `CD` builds, pushes to ACR and deploys to `dev` with no stored secret
- [ ] The deploy's verification step confirms the serving revision matches the tag
- [ ] Add `ci_principal_ids = ["<CI_PRINCIPAL>"]` to `terraform.tfvars` and
      re-apply so the AcrPush assignment is managed by Terraform rather than by
      the ad-hoc command above

---

## Evidence capture

Run this after the checklist. It writes a timestamped directory of text and JSON
you can reference later, and screenshots are worth taking for the portal views
(Grafana, alert rules, the Actions run).

```bash
cd azure-aks-production-platform
EV="evidence/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$EV"

# --- Terraform -----------------------------------------------------------------
terraform -chdir=terraform/environments/dev output -json > "$EV/terraform-outputs.json"
terraform -chdir=terraform/environments/dev plan -no-color -detailed-exitcode \
  > "$EV/terraform-plan-after-apply.txt" 2>&1 \
  && echo "convergent: no changes" >> "$EV/terraform-plan-after-apply.txt"
az resource list -g "$RG" --query "[].{name:name,type:type,tags:tags}" -o json \
  > "$EV/azure-resources.json"

# --- Cluster -------------------------------------------------------------------
kubectl get nodes -o wide                        > "$EV/nodes.txt"
kubectl get all,ingress,netpol,hpa,cm,sa -n dev  > "$EV/dev-objects.txt"
kubectl describe deployment platform-api -n dev  > "$EV/deployment-describe.txt"
kubectl get pod -n dev -l app.kubernetes.io/name=platform-api -o yaml \
  > "$EV/pod-spec.yaml"
kubectl top nodes                                > "$EV/top-nodes.txt" 2>&1
kubectl top pods -n dev                          > "$EV/top-pods.txt" 2>&1
az aks show -g "$RG" -n "$CLUSTER" \
  --query "{version:kubernetesVersion,sku:sku,localAccounts:disableLocalAccounts,oidc:oidcIssuerProfile.enabled,workloadId:securityProfile.workloadIdentity.enabled,networkPlugin:networkProfile.networkPlugin,mode:networkProfile.networkPluginMode,policy:networkProfile.networkPolicy}" \
  -o json > "$EV/aks-config.json"

# --- Identity and registry ------------------------------------------------------
az acr show -n "$ACR" --query "{name:name,sku:sku.name,admin:adminUserEnabled}" -o json \
  > "$EV/acr-config.json"
az acr repository show-tags -n "$ACR" --repository platform-api -o json \
  > "$EV/acr-tags.json"
az identity federated-credential list \
  --identity-name "id-wi-dev-platform-dev-uks" -g "$RG" \
  --query "[].{name:name,subject:subject,issuer:issuer}" -o json \
  > "$EV/federated-credentials.json"
kubectl get sa platform-api -n dev -o yaml > "$EV/service-account.yaml"
kubectl exec -n dev deploy/platform-api -- ls -la /var/run/secrets/azure/tokens/ \
  > "$EV/projected-token.txt" 2>&1

# --- Application behaviour ------------------------------------------------------
kubectl port-forward -n dev svc/platform-api 8080:80 >/dev/null 2>&1 &
PF=$!; sleep 5
{
  echo "== GET /";       curl -s localhost:8080/       | jq
  echo "== GET /health"; curl -s localhost:8080/health | jq
  echo "== GET /ready";  curl -s -i localhost:8080/ready | head -1
} > "$EV/endpoints.txt" 2>&1
curl -s localhost:8080/metrics > "$EV/metrics-exposition.txt"
kill $PF 2>/dev/null

kubectl logs -n dev deploy/platform-api --tail=100 > "$EV/app-logs.json"

# --- Helm ----------------------------------------------------------------------
helm list -n dev -o json                > "$EV/helm-releases.json"
helm history platform-api -n dev -o json > "$EV/helm-history.json"

# --- Monitoring ----------------------------------------------------------------
az monitor metrics alert list -g "$RG" --query "[].{name:name,severity:severity,enabled:enabled}" -o json \
  > "$EV/metric-alerts.json"
az monitor scheduled-query list -g "$RG" --query "[].{name:name,severity:severity,enabled:enabled}" -o json \
  > "$EV/log-alerts.json"
az monitor data-collection rule association list \
  --resource "$(az aks show -g "$RG" -n "$CLUSTER" --query id -o tsv)" -o json \
  > "$EV/dcr-associations.json" 2>&1

# --- Cost actually incurred (available the next day) ----------------------------
az consumption usage list --start-date "$(date -u -d '1 day ago' +%Y-%m-%d)" \
  --end-date "$(date -u +%Y-%m-%d)" \
  --query "[?contains(instanceName, 'platform-dev')].{name:instanceName,cost:pretaxCost,currency:currency}" \
  -o json > "$EV/cost.json" 2>&1

echo "Evidence written to $EV"
ls -la "$EV"
```

**Before committing any of it**, check that nothing sensitive came along:

```bash
grep -riE "subscription|tenant|clientId|BEGIN |password|api-signing-key" "$EV" | head
```

`terraform-outputs.json` and `federated-credentials.json` contain subscription
and tenant identifiers. Those are not secrets, but they are yours — redact them
before publishing, or keep the evidence directory out of git entirely (add
`evidence/` to `.gitignore`). Screenshots with a portal URL visible leak the
subscription ID too.

---

## Teardown

Order matters: the ingress controller owns an Azure load balancer and public IP
that Terraform did not create. Removing it first avoids a destroy that fails on
resources it does not know about.

```bash
# 1. Application and ingress - releases the load balancer and public IP.
helm uninstall platform-api  -n dev
helm uninstall ingress-nginx -n ingress-nginx

# 2. Confirm the load balancer is gone before continuing.
kubectl get svc -A --field-selector spec.type=LoadBalancer   # expect none

# 3. Destroy the environment.
cd terraform/environments/dev
terraform destroy                       # review the plan, then confirm

# 4. Verify nothing is left behind. Both should return empty or NotFound.
az group show -n "$RG" -o none 2>&1 | grep -q "not be found" \
  && echo "environment resource group gone"
az group list --query "[?starts_with(name, 'rg-platform-dev')].name" -o tsv
az group list --query "[?starts_with(name, 'MC_')].name" -o tsv   # AKS node group
```

Then decide about the two things that outlive an environment:

```bash
# Key Vault: dev has purge protection OFF, so it can be purged immediately.
# Without this, soft delete holds the vault name for 7 days.
az keyvault list-deleted --query "[].name" -o tsv
az keyvault purge --name "$KV" --location uksouth

# Remote state: keep it if you plan to redeploy - it costs pennies and the
# delete lock exists to stop you removing it by accident.
az lock delete --name tfstate-do-not-delete -g rg-tfstate-platform
az group delete -n rg-tfstate-platform --yes --no-wait
```

Finally, confirm spend has stopped — the following day, since consumption data
lags:

```bash
az consumption usage list \
  --start-date "$(date -u -d '2 days ago' +%Y-%m-%d)" \
  --end-date "$(date -u +%Y-%m-%d)" \
  --query "[?contains(instanceName,'platform')].{name:instanceName,cost:pretaxCost}" -o table
```

A budget alert is cheap insurance against forgetting any of this:

```bash
az consumption budget create --budget-name platform-validation \
  --amount 20 --time-grain Monthly --category Cost \
  --start-date "$(date -u +%Y-%m-01)" --end-date "$(date -u -d '+1 year' +%Y-%m-01)"
```

---

## Recording the outcome

Update [DEPLOYMENT_STATUS.md](../DEPLOYMENT_STATUS.md) with what you actually
observed — including anything that failed or needed a workaround. A validation
record that lists only successes is not credible, and the failures are usually
the most interesting thing to discuss in an interview.
