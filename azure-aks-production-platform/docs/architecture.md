# Architecture

How the platform is put together, and — more usefully — what was considered and
rejected at each decision point.

## Design principles

1. **Identity over credentials.** If a design needs a stored secret, look for the
   version that does not.
2. **Environments are isolated, not shared.** Separate resource group, VNet,
   cluster, registry, vault and state file per environment.
3. **One definition, many environments.** Sizing and hardening are inputs, not
   forks of the code.
4. **Fail in CI, not in a cluster.** Every check that can run without cloud
   credentials runs on every pull request.
5. **Every deviation is written down.** A suppression without a reason is debt
   disguised as a green check.

## Component design

### Resource groups

One per environment (`rg-platform-{dev,stg,prd}-uks`), plus the AKS-managed node
resource group. Environment isolation is at the resource-group and subscription
boundary, which is where Azure RBAC, policy and budgets naturally attach.

`prevent_deletion_if_contains_resources` is enabled on the provider, so a
`terraform destroy` fails rather than silently removing something that was
created outside Terraform.

### Networking

| Subnet | Purpose | NSG posture |
| --- | --- | --- |
| `snet-aks-system` | System node pool | Inbound only from the ingress subnet |
| `snet-aks-user` | Application node pool | Inbound only from the ingress subnet |
| `snet-ingress` | Ingress controller data path | 80/443 from `allowed_ingress_source_prefixes` |
| `snet-private-endpoints` | ACR and Key Vault private endpoints | VNet-internal only |

**Azure CNI Overlay** was chosen over the alternatives:

| Option | Trade-off | Verdict |
| --- | --- | --- |
| kubenet | Small VNet footprint, but no NetworkPolicy support with Cilium and a legacy path on AKS | Rejected |
| Azure CNI (flat) | Pods get VNet IPs, which is convenient for direct addressing but exhausts the VNet as node count grows | Rejected |
| **Azure CNI Overlay** | Pods use a separate overlay CIDR; only nodes consume VNet IPs | **Chosen** |

Overlay's cost is that pod IPs are not routable from outside the cluster. Nothing
in this platform needs that; a workload that does would use a Service.

**Cilium** provides the network policy data plane. It enforces policy in eBPF, so
enforcement cost scales with the number of rules rather than the number of pods,
unlike the iptables-based `azure` policy engine.

### AKS cluster

Two node pools:

- **System pool** — tainted `CriticalAddonsOnly` (`only_critical_addons_enabled`),
  so cluster add-ons cannot be starved by application workloads. Three nodes
  across three zones in production, so losing a zone never leaves CoreDNS
  without a replica.
- **User pool** — application workloads, scaling independently. Application pods
  are pinned here by the `kubernetes.azure.com/mode: user` node selector.

Both use **ephemeral OS disks**: faster, free, and appropriate because nodes are
cattle. Both use **Azure Linux**, which has a smaller package surface than
Ubuntu.

Node images auto-upgrade weekly inside a maintenance window;
`automatic_upgrade_channel = "patch"` takes Kubernetes patch releases
automatically while leaving minor upgrades as a planned change.

`lifecycle.ignore_changes` covers `node_count` and `kubernetes_version` — the
autoscaler and the upgrade channel own those, and Terraform must not fight them.

### Namespaces and cluster topology

Every cluster carries all three namespaces - `dev`, `staging` and `production` -
each with its own quota, limit range, default-deny policy and workload identity.
Combined with one cluster per environment, that means a cluster normally uses
one namespace and the others sit empty.

That is deliberate. It keeps two topologies valid from the same code:

- **Cluster per environment** (what the environment roots provision): stronger
  isolation - separate control planes, separate blast radius, separate upgrade
  schedules. The matching namespace is the one in use.
- **Single cluster, namespace per environment**: materially cheaper (one control
  plane, one node-pool baseline instead of three). Apply one environment root and
  deploy all three namespaces to it. The quotas, limit ranges and per-namespace
  workload identities are what make this safe, and they exist either way.

The CD pipeline deploys to the namespace named after the environment, so the
same workflow works under both topologies with no change.

### Ingress

**NGINX Ingress Controller** is the default. The Azure-native alternative,
Application Gateway Ingress Controller (AGIC), was considered:

| | NGINX | AGIC |
| --- | --- | --- |
| WAF | Needs a separate layer (Front Door, or ModSecurity) | Built in |
| Portability | Runs anywhere | Azure only |
| Rollout speed | Seconds (in-cluster reload) | Minutes (Application Gateway config push) |
| Cost | Node capacity + one load balancer | Application Gateway v2 from ~$250/month |

NGINX wins on iteration speed and portability, which matter more for a reference
implementation. A production deployment with regulatory WAF requirements should
front NGINX with Azure Front Door Premium, keeping the fast in-cluster path and
gaining a managed WAF at the edge.

### Registry

One ACR per environment. Sharing a registry across environments would mean a
single `AcrPush` compromise reaching production, and admin credentials are
disabled everywhere — pulls use the kubelet identity, pushes use the CI federated
identity.

Premium (staging and production) additionally enables private endpoints, content
trust, quarantine, zone redundancy, dedicated data endpoints and untagged-manifest
retention. Dev runs Standard purely on cost.

### Secrets

Key Vault with **RBAC authorization** rather than access policies: role
assignments are visible alongside every other Azure permission, support PIM, and
avoid the classic access-policy mistake of granting vault-wide rights.

In-cluster, the **Secrets Store CSI driver** mounts secrets as files, optionally
projecting them into a Kubernetes Secret so they can be read as environment
variables. The trade-off is explicit: `syncAsKubernetesSecret: true` puts the
value in etcd (encrypted at rest, readable by anyone with `get secrets` in that
namespace); `false` means file-only, which is stronger but requires the
application to read from disk. This platform enables the sync and compensates by
denying secret read access to the `developer` Role.

### Observability

Log Analytics receives Container Insights data, control-plane logs and Key Vault
audit events. A separate Azure Monitor workspace holds Prometheus metrics —
Microsoft's managed Prometheus, so there is no Prometheus server to run, back up
or scale.

Grafana is provisioned per environment for staging and production. It queries
both workspaces through its system-assigned identity, which is granted
`Monitoring Data Reader` at the resource-group scope.

## Environment differences

| Setting | dev | staging | production |
| --- | --- | --- | --- |
| AKS SKU tier | Free (no SLA) | Standard | Standard |
| Availability zones | 1 | 3 | 3 |
| ACR SKU | Standard | Premium | Premium |
| Private endpoints | No | Yes | Yes |
| API server IP restriction | Open | Restricted | Restricted |
| Key Vault purge protection | No | No | Yes (90-day soft delete) |
| Log retention / daily cap | 30 days / 1 GB | 30 days / 5 GB | 90 days / 25 GB |
| Managed Grafana | No | Yes | Yes |
| User pool | 1–3 × D2ds_v5 | 2–6 × D4ds_v5 | 3–12 × D8ds_v5 |
| Alert thresholds | Relaxed | Default | Tightened |

Staging deliberately mirrors production's *shape* — same SKUs, zonal spread and
private-endpoint posture — at smaller scale, so that a DNS or firewall mistake
surfaces there rather than during a production release.

## Terraform structure

```
modules/
  networking/  acr/  keyvault/  monitoring/  aks/  alerts/
  platform/    <- composition: calls all six, owns naming and tagging
environments/
  dev/  staging/  prod/   <- backend + provider + sizing only
```

Each environment root is a thin wrapper. The alternative — copying the module
calls into each environment — was rejected because three copies drift, and the
drift is always discovered in production.

**Naming** follows the Cloud Adoption Framework shape
`<type>-<workload>-<env>-<region>`. ACR and Key Vault have globally unique names
and restricted character sets, so they get a deterministic six-character suffix
derived from `sha256(subscription_id + environment + workload)` — deterministic
rather than `random_string`, because a random suffix lives in state and losing
state would mean losing the ability to reproduce the names.

**Tagging** is mandatory and uniform: `Workload`, `Environment`, `ManagedBy`,
`Repository`, `Owner`, `CostCentre`, `Criticality`. `Repository` makes it obvious
that portal edits will be reverted by the next apply.

**State** lives in an Azure Storage account with versioning, soft delete, shared
key access disabled and a delete lock, created by
`scripts/bootstrap-remote-state.sh`. One state file per environment; blob leases
provide locking.

## What this architecture does not do

Being explicit about the boundaries is part of the design:

- **No multi-region active-active.** One region per environment. The DR model is
  rebuild-from-code, documented with a ~4 hour RTO, not a hot standby.
- **No service mesh.** mTLS between services, traffic shifting and per-service
  circuit breaking would need Istio or Linkerd. For one service, the operational
  cost is not justified.
- **No GitOps reconciliation.** Helm from CI is push-based; drift between deploys
  is not corrected. Argo CD or Flux is the recommended next step.
- **No stateful workloads.** No StatefulSets, PVs or database. Adding them
  changes the DR model substantially — backup, restore and data residency all
  become part of the story.
- **No private cluster by default.** The API server is public (IP-restricted in
  staging and production) so that GitHub-hosted runners can deploy. Making it
  private requires self-hosted runners; the switch exists
  (`private_cluster_enabled`) but flipping it without runners breaks CD.
