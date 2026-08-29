# Operations runbook

Procedures for the failures this platform is actually likely to have. Each
section is written to be followed under pressure: diagnose, decide, act.

**First 60 seconds of any incident:**

```bash
NS=production
kubectl get pods -n $NS -o wide
kubectl get events -n $NS --sort-by=.lastTimestamp | tail -20
kubectl top pods -n $NS
kubectl get deploy,hpa,pdb -n $NS
```

---

## Unhealthy pods

**Symptoms:** `PlatformApiNoReadyReplicas`, `PodCrashLooping`, pods in
`CrashLoopBackOff`, `ImagePullBackOff` or `Pending`.

### Diagnose

```bash
kubectl describe pod <pod> -n $NS          # Events section is at the bottom
kubectl logs <pod> -n $NS --tail=100
kubectl logs <pod> -n $NS --previous       # the crashed container, not the new one
```

Read the pod's **status reason** first — it determines everything that follows:

| Reason | Meaning | Go to |
| --- | --- | --- |
| `CrashLoopBackOff` | Container starts and exits | Below |
| `OOMKilled` (in `lastState`) | Exceeded its memory limit | [High memory](#high-memory) |
| `ImagePullBackOff` | Cannot pull the image | Below |
| `Pending` | Cannot be scheduled | [Node pressure](#node-pressure) |
| `Running` but not ready | Readiness probe failing | Below |

### CrashLoopBackOff

```bash
kubectl logs <pod> -n $NS --previous | tail -50
```

Usual causes, in order of likelihood: a missing configuration value, a Key Vault
secret the workload identity cannot read, or a genuine application bug.

Check the identity path before blaming the app:

```bash
# Did the CSI driver mount anything?
kubectl describe pod <pod> -n $NS | grep -A5 secrets-store
# Is the service account annotated with the right client ID?
kubectl get sa platform-api -n $NS -o yaml
```

A `403` from Key Vault in the CSI logs means the workload identity is missing its
`Key Vault Secrets User` assignment, or the federated credential subject does not
match `system:serviceaccount:<namespace>:platform-api`.

### ImagePullBackOff

```bash
kubectl describe pod <pod> -n $NS | grep -A5 Failed
```

- **401/403** — the kubelet identity has lost `AcrPull`. Re-apply Terraform:
  `terraform apply -target=module.platform.module.acr`.
- **not found** — the tag does not exist. Confirm the CD run pushed it:
  `az acr repository show-tags -n <acr> --repository platform-api -o table`.

### Readiness failing while running

```bash
kubectl port-forward <pod> 8080:8000 -n $NS &
curl -i localhost:8080/ready
```

`503` with `{"ready": false}` means the app has deliberately withdrawn itself —
it is starting up or draining. If it persists past `initialDelaySeconds`, look at
the logs for a startup step that never completed.

### Act

```bash
# Restart one pod (the ReplicaSet replaces it)
kubectl delete pod <pod> -n $NS

# Restart the whole deployment
kubectl rollout restart deployment/platform-api -n $NS
```

If the cause is the release itself, go to [Application rollback](#application-rollback).

---

## Failed deployment

**Symptoms:** the `deploy-*` job fails, `alert-failed-deployment-*` fires, or
`DeploymentReplicasUnavailable`.

### Diagnose

```bash
kubectl rollout status deployment/platform-api -n $NS --timeout=30s
kubectl describe deployment platform-api -n $NS | tail -25
kubectl get rs -n $NS -l app.kubernetes.io/name=platform-api
```

Helm deploys with `--atomic`, so a failed rollout has **already been rolled
back** — the cluster is on the previous release. The job failing is the alert;
the service should still be serving. Confirm that before doing anything else:

```bash
helm history platform-api -n $NS
kubectl get pods -n $NS -l app.kubernetes.io/name=platform-api
```

### Common causes

| Symptom in the CI log | Cause | Fix |
| --- | --- | --- |
| `timed out waiting for the condition` | New pods never became ready | Follow [Unhealthy pods](#unhealthy-pods) against the failed ReplicaSet |
| `admission webhook denied` | Pod Security Admission rejected the pod | Compare the chart's `securityContext` against the namespace's `enforce` label |
| `exceeded quota` | Namespace ResourceQuota is full | `kubectl describe quota -n $NS`; scale down or raise the quota |
| `Insufficient cpu/memory` | No node capacity | [Node pressure](#node-pressure) |
| `no matches for kind "SecretProviderClass"` | CSI add-on missing | Confirm `key_vault_secrets_provider` in the AKS module was applied |

### Act

Fix forward if the cause is understood and small; otherwise roll back and
investigate with production stable.

---

## Application rollback

**When:** a release is serving errors, and the cause is not obvious within a few
minutes. Roll back first, investigate second.

```bash
helm history platform-api -n $NS

# Previous release
helm rollback platform-api -n $NS --wait --timeout 5m

# A specific revision
helm rollback platform-api 7 -n $NS --wait --timeout 5m

kubectl rollout status deployment/platform-api -n $NS
curl -s https://platform-api.example.com/ | jq .revision   # confirm the revision
```

**Then prevent the bad image from being redeployed.** The CD pipeline deploys on
every push to `main`, so the next merge will ship the same broken artifact unless
the commit is reverted:

```bash
git revert <bad-commit> && git push
```

If Helm's own state is broken (`another operation in progress`):

```bash
helm rollback platform-api -n $NS --cleanup-on-fail
# Last resort, after confirming no deploy is genuinely running:
kubectl delete secret -n $NS -l owner=helm,status=pending-upgrade
```

---

## Node pressure

**Symptoms:** pods `Pending`, `NodeCpuSaturation`/`NodeMemoryPressure`,
`alert-node-*`, evictions.

### Diagnose

```bash
kubectl get nodes -o wide
kubectl top nodes
kubectl describe node <node> | grep -A10 "Allocated resources"
kubectl get pods --all-namespaces --field-selector=status.phase=Pending
kubectl describe pod <pending-pod> -n $NS | grep -A10 Events
```

Distinguish the three cases, because the fixes differ:

| Message | Cause | Fix |
| --- | --- | --- |
| `Insufficient cpu` / `Insufficient memory` | Genuinely out of capacity | Autoscaler should add a node — check it is not at `max_count` |
| `didn't match pod topology spread constraints` | Zone spread cannot be satisfied | Production uses `DoNotSchedule` by design; add capacity in the short zone |
| `had taint {CriticalAddonsOnly}` | Pod tried to land on the system pool | Missing `nodeSelector: kubernetes.azure.com/mode: user` |

Check the autoscaler is actually trying:

```bash
kubectl -n kube-system logs -l app=cluster-autoscaler --tail=50
az aks nodepool show -g <rg> --cluster-name <cluster> -n user \
  --query "{min:minCount,max:maxCount,current:count}"
```

### Act

```bash
# Raise the ceiling (Terraform is the source of truth - update user_node_pool
# and apply; this is the emergency path only)
az aks nodepool update -g <rg> --cluster-name <cluster> -n user \
  --update-cluster-autoscaler --min-count 3 --max-count 20

# Drain a sick node - the PDB paces the eviction automatically
kubectl cordon <node>
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data --timeout=300s
```

If a drain hangs, a PDB is doing its job: `kubectl get pdb -n $NS` and check
`ALLOWED DISRUPTIONS`. Zero means evicting would breach the budget — scale the
deployment up first rather than deleting the PDB.

---

## High CPU

**Symptoms:** `ContainerCpuThrottling`, `PlatformApiHighLatency`,
`alert-node-cpu-*`.

### Diagnose

```bash
kubectl top pods -n $NS --sort-by=cpu
kubectl get hpa -n $NS
kubectl describe hpa platform-api -n $NS | tail -20
```

Throttling and high usage are different problems:

```promql
# Throttled fraction - if this is high, the limit is the constraint
rate(container_cpu_cfs_throttled_periods_total{namespace="production"}[5m])
  / rate(container_cpu_cfs_periods_total{namespace="production"}[5m])
```

| Finding | Meaning | Action |
| --- | --- | --- |
| Throttling high, usage near the limit | The CPU limit is too tight | Raise `resources.limits.cpu` |
| Usage high, HPA at `maxReplicas` | Genuinely out of headroom | Raise `autoscaling.maxReplicas` |
| Usage high, HPA not scaling | Metrics missing, or requests set too high | `kubectl describe hpa`; check metrics-server |
| One pod hot, others idle | Uneven load balancing or a stuck request | Restart the pod; check keepalive behaviour at the ingress |

### Act

```bash
# Immediate headroom (the HPA will re-take control on its next cycle)
kubectl scale deployment/platform-api -n $NS --replicas=8
```

Then make it permanent in `charts/platform-api/values-<env>.yaml` and let CD
deploy it. A manual `kubectl scale` is a stopgap, not a fix — the next Helm
upgrade reconciles it away.

---

## High memory

**Symptoms:** `ContainerMemoryNearLimit`, `OOMKilled`, `alert-node-memory-*`.

### Diagnose

```bash
kubectl top pods -n $NS --sort-by=memory
kubectl get pod <pod> -n $NS -o jsonpath='{.status.containerStatuses[0].lastState}' | jq
```

`"reason": "OOMKilled"` is unambiguous: the container exceeded its limit and the
kernel killed it. Memory is not compressible — unlike CPU, there is no throttling
step before the kill.

```promql
# Working set as a fraction of the limit
container_memory_working_set_bytes{namespace="production", container!=""}
  / container_spec_memory_limit_bytes{namespace="production", container!=""}
```

| Pattern | Meaning | Action |
| --- | --- | --- |
| Sawtooth: climbs, OOMKill, repeats | Memory leak | Fix the application; raise the limit only to buy time |
| Plateau just under the limit | Limit is simply too low | Raise request **and** limit together |
| Spike under specific load | Unbounded request handling | Bound the work (body size, concurrency) |

### Act

Raise both request and limit in the values file — they are set equal deliberately
so the pod is scheduled with the memory it is allowed to use:

```yaml
resources:
  requests:
    memory: 512Mi
  limits:
    memory: 512Mi
```

---

## Kubernetes troubleshooting

### Cannot connect to the cluster

```bash
az aks get-credentials -g <rg> -n <cluster> --overwrite-existing
kubelogin convert-kubeconfig -l azurecli
kubectl auth can-i get pods -n production
```

`local_account_disabled = true`, so `--admin` does not work by design. A
`Forbidden` means your Entra ID group lacks the role assignment, not that the
cluster is broken.

### Service returns 503 through ingress but pods are healthy

```bash
kubectl get endpoints platform-api -n $NS       # empty = no ready pods
kubectl describe ingress platform-api -n $NS
kubectl -n ingress-nginx logs -l app.kubernetes.io/name=ingress-nginx --tail=50
```

Empty endpoints with running pods means readiness is failing — the Service is
correctly refusing to route to pods that say they are not ready.

### DNS resolution failing in a pod

```bash
kubectl run -n $NS dnstest --rm -it --image=busybox:1.36 --restart=Never -- \
  nslookup platform-api.$NS.svc.cluster.local
```

If this fails while CoreDNS is healthy, the NetworkPolicy is the first suspect:
egress to `kube-system` on port 53 must be allowed. A namespace with the
default-deny policy and no DNS egress rule breaks everything, confusingly, as a
timeout rather than a DNS error.

### Verifying workload identity

```bash
kubectl get sa platform-api -n $NS -o jsonpath='{.metadata.annotations}'
kubectl exec -n $NS deploy/platform-api -- \
  ls -la /var/run/secrets/azure/tokens/    # the projected token
kubectl -n kube-system logs -l app=secrets-store-csi-driver --tail=50
```

### One-off subscription features

```bash
# Required before host encryption can be enabled on node pools
az feature register --namespace Microsoft.Compute --name EncryptionAtHost
az feature show --namespace Microsoft.Compute --name EncryptionAtHost \
  --query properties.state
az provider register --namespace Microsoft.Compute
```

---

## Teardown

For a full walkthrough of deploying, validating and destroying the dev
environment, see [dev-validation.md](dev-validation.md).

```bash
helm uninstall platform-api -n production
helm uninstall ingress-nginx -n ingress-nginx      # releases the load balancer
cd terraform/environments/prod && terraform destroy
```

Two deliberate obstacles in production:

- `prevent_deletion_if_contains_resources` fails the destroy if anything was
  created outside Terraform. Find it, decide whether it matters, then remove it.
- Key Vault **purge protection** keeps the vault (and its name) for 90 days.
  It cannot be purged early. Plan for the name to be unavailable, or use a
  different `environment` value when rebuilding.

---

## Escalation

| Signal | First responder | Escalate when |
| --- | --- | --- |
| Single pod unhealthy | On-call engineer | More than one replica affected |
| Failed deployment | Deploying engineer | Rollback does not restore service |
| Node pressure | On-call engineer | Autoscaler is at max and still short |
| Region-wide Azure incident | Incident lead | Immediately — see [disaster-recovery.md](disaster-recovery.md) |
