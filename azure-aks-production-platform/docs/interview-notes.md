# Interview notes

Decision rationale for this repository, in the form the questions usually arrive.
Every answer names the alternative that was rejected, because "why not X" is the
follow-up.

---

## Identity and security

### Why workload identity instead of a secret, or pod-managed identity?

Three options for a pod that needs Key Vault:

| Option | Problem |
| --- | --- |
| Kubernetes Secret with a service principal password | A long-lived credential in etcd, visible to anyone with `get secrets`, rotated manually or never |
| AAD Pod Identity (deprecated) | Node-level identity assignment; a race on pod start, and any pod on the node could obtain the token |
| **Workload Identity** | Chosen |

Workload identity projects a short-lived OIDC token into the pod, which Entra ID
exchanges for an access token. The federated credential's subject is
`system:serviceaccount:<namespace>:<name>`, so the binding is enforced by the
identity provider, not by convention. There is no secret at rest, and a pod in
`dev` cannot obtain the `production` identity even if it names the same service
account, because the namespace is part of the subject.

### How does CI authenticate to Azure without a secret?

GitHub Actions mints an OIDC token describing the repository, ref and
environment. A federated credential on a user-assigned identity trusts that
issuer for a specific subject. `azure/login@v2` exchanges it for an Azure access
token valid for about an hour. Nothing is stored in the repository — and a fork
cannot use it, because the subject would not match.

### What is the least-privilege story?

Five identities, each with one job:

| Identity | Role | Scope |
| --- | --- | --- |
| CI federated identity | `AcrPush`, AKS RBAC Writer | One registry, one cluster |
| Cluster identity | `Network Contributor` | One VNet — not the subscription |
| Kubelet identity | `AcrPull` | One registry |
| Workload identity (per namespace) | `Key Vault Secrets User` | One vault, read-only |
| Human admin group | `cluster-admin` | Cluster, ideally PIM-elevated |

The one worth pointing at is the cluster identity: the common AKS mistake is
`Contributor` at subscription scope. `Network Contributor` on the VNet is the
documented minimum, and it is what the module grants.

### Why is the API server public?

A private cluster puts the API server on a private endpoint, which GitHub-hosted
runners cannot reach — CD would need self-hosted runners or a private agent pool.
That is a real cost, so the trade is made explicitly rather than by default:
staging and production restrict the API server to authorized IP ranges, local
accounts are disabled so every call is an Entra ID identity, and
`private_cluster_enabled` exists for when runners are available. It is also
recorded as an accepted risk in `.checkov.yaml` rather than silently suppressed.

### Why sync Key Vault secrets into a Kubernetes Secret at all?

Because the application reads configuration from environment variables, and the
CSI driver's `secretObjects` is the supported way to get there. The cost is
explicit: the value lands in etcd (encrypted at rest, readable by anyone with
`get secrets` in that namespace). The compensating control is that the
`developer` Role has no `secrets` access. If the threat model forbids it, set
`syncAsKubernetesSecret: false` and read the mounted file — the chart supports
both, and the switch is one value.

---

## Kubernetes

### Why omit `replicas` from the Deployment when the HPA is enabled?

Because leaving it in means every `helm upgrade` writes the chart's replica count
back into the Deployment, overwriting whatever the autoscaler had decided. The
symptom is a fleet that silently drops from 12 replicas to 3 during a routine
deploy, at peak. The chart omits `replicas` entirely when `autoscaling.enabled`
is true.

### Why `minAvailable` rather than `maxUnavailable` on the PDB?

`maxUnavailable: 1` means something different at 3 replicas than at 20.
`minAvailable: 2` stays correct as the HPA changes the count: a drain may evict
down to two remaining pods and no further. It also fails safe — if the HPA has
scaled to exactly 2, the drain blocks rather than taking the service to one
replica.

### Why does the memory request equal the memory limit?

CPU is compressible: exceeding the limit means throttling, which is survivable,
so a limit above the request lets a pod absorb bursts. Memory is not: exceeding
the limit means an OOMKill. Setting request equal to limit gives the pod a
guaranteed allocation equal to what it is allowed to use, and makes its QoS class
`Burstable` with no memory overcommit — so memory pressure on the node cannot
turn into an eviction of this pod for being over its request.

### Why does the HPA scale on CPU only?

Adding a replica does not reduce any existing pod's memory usage, so a
memory-triggered scale-up spends money without addressing the cause. A rising
working set is almost always a leak or an unbounded request, and the right
response is an alert (`ContainerMemoryNearLimit`) and a fix, not more pods. CPU
is different: it is the signal that actually tracks concurrent load for this
workload. The value exists (`targetMemoryUtilizationPercentage`) for workloads
where memory genuinely tracks concurrency - it is just null here.

### Why both a readiness probe and a startup probe?

A startup probe suspends liveness until the app has started, which lets liveness
stay aggressive (3 failures at 10s) for the rest of the pod's life without
killing a slow start. Without it, the choice is between a liveness probe too slow
to catch a wedged process, and one that kills healthy pods during a cold start.

### What does the drain sequence actually do, and why?

On SIGTERM the app sets `app_ready = 0` and returns 503 from `/ready`, then
sleeps `drainSeconds` before shutting down. That gap exists because endpoint
removal is *eventually* consistent: kube-proxy and the ingress controller need a
moment to stop sending traffic. Without the gap, a shutting-down pod refuses
connections that were routed to it microseconds earlier, which shows up as 502s
during every deploy. `drainSeconds` is deliberately below
`terminationGracePeriodSeconds` so the kubelet never SIGKILLs mid-drain.

### Why is the metrics `path` label the route template?

`http_requests_total{path="/orders/12345"}` creates a new series per ID. A
scanner walking random URLs would create unbounded series and take Prometheus
down. Using the matched route — and `"unmatched"` for everything else — bounds
cardinality at the number of routes. There is a test asserting this.

### Why Cilium instead of the Azure network policy engine?

Cilium enforces policy in eBPF, so the cost scales with the number of rules
rather than with pods × rules of iptables evaluation. It is also the direction
AKS itself is moving (Azure CNI Powered by Cilium). The trade is a newer data
plane with a different debugging toolchain.

---

## Terraform

### Why a `platform` composition module instead of module calls per environment?

Three copies of the same twenty module calls drift, and the drift is discovered
in production. With a composition module, each environment root is a backend, a
provider and a sizing block, and an architectural change lands once. The cost is
one more layer of variable plumbing, which is a fair price.

### Why a deterministic name suffix instead of `random_string`?

`random_string` stores its value in state, so a lost state file means the names
can never be reproduced — a rebuild would create `acrplatformdevx7f2q9` instead
of the existing registry. `substr(sha256(subscription_id + environment +
workload), 0, 6)` is deterministic from inputs that are themselves stable, so the
same inputs always yield the same names.

### What is in `ignore_changes`, and why?

`default_node_pool[0].node_count` and `kubernetes_version` on the cluster,
`node_count` and `orchestrator_version` on the user pool. The cluster autoscaler
owns the node count and the auto-upgrade channel owns the patch version; without
`ignore_changes`, every plan would propose reverting them, and someone would
eventually apply it during an incident.

### How is state protected?

Azure Storage with ZRS, blob versioning, 30-day soft delete, container delete
retention, shared-key access disabled (so access is Entra ID only) and a
`CanNotDelete` lock on the resource group. One state file per environment, so a
mistake in dev cannot touch production. Locking uses blob leases, which Terraform
handles natively.

### How would you handle drift?

Today: `terraform plan` in CI on every PR shows it, and the `Repository` tag on
every resource tells anyone in the portal where the truth lives. Properly: a
scheduled plan that opens an issue on non-empty diffs, and Deny-effect Azure
Policy on the resource groups so manual changes are rejected rather than
detected. That is on the hardening list, not implemented.

---

## CI/CD

### Why build once and promote the same tag?

Rebuilding per environment means production runs an artifact that was never
tested — different base-image digest, different transitive dependency, different
build cache. Building once and promoting the same tag makes "it passed staging" a
statement about the exact bytes in production. It also makes rollback trivially
correct: the previous tag is a known artifact, not a rebuild.

### How does the production approval gate work?

`deploy-production` targets a GitHub Environment with required reviewers. GitHub
pauses the job until an approver acts; the approval is recorded against the run.
It is a property of the environment rather than a step in the workflow, so it
cannot be skipped by editing the job — changing it requires repository settings
access, which is itself audited.

### Why `--atomic` on the Helm deploy?

Without it, a failed rollout leaves half the replicas on the new version and the
release marked failed — you are debugging a mixed fleet. `--atomic` rolls back
automatically, so a failed deploy leaves the previous release serving and the CI
job red. The failure is loud in the place where it is safe to be loud.

### What happens if two merges land at once?

`concurrency: cd-${{ github.ref }}` with `cancel-in-progress: false` queues them.
Cancelling is deliberately not used: interrupting a `helm upgrade` mid-flight
leaves a release in `pending-upgrade`, which then requires manual cleanup.

### Why does the deploy verify with a curl against `/`?

`kubectl rollout status` proves pods became ready; it does not prove they are
running the revision that was just deployed — a healthy older ReplicaSet
satisfies it. Curling `/` and matching `"revision":"<tag>"` proves the intended
build is actually serving.

---

## Observability

### How do you know a deploy caused an incident?

The Grafana dashboard draws rollout annotations from
`kube_deployment_status_observed_generation`, so a spike lines up against a
deploy marker visually. `/` also reports its revision, and `app_build_info`
carries it as a label, so "what is running right now" never requires reading CI
logs.

### Why split alerting between Azure Monitor and Prometheus?

Azure Monitor already collects node, pod and event data with no extra
infrastructure, and its log alerts can query Container Insights tables that no
Prometheus scrape produces. Prometheus is where the application's own SLIs live.
Splitting by data ownership avoids paying twice to collect the same signal.

### Why is `kube-audit` not enabled?

It is the single most expensive control-plane log category — every read included.
`kube-audit-admin` records mutating calls at a fraction of the volume, which is
what matters for "who changed what". Full `kube-audit` gets enabled during an
investigation and turned off afterwards.

### What is missing from the observability story?

Distributed tracing (nothing to correlate with one service), synthetic external
monitoring, and burn-rate SLO alerting rather than static thresholds. All three
are named in `docs/observability.md` rather than left for a reviewer to notice.

---

## Cost

### Where does the money actually go?

Compute first (node pools dominate every environment), then log ingestion, then
the fixed costs — AKS Standard tier at ~$73/month per cluster, Premium ACR at
~$50/month, Managed Grafana. The biggest *avoidable* cost is log ingestion, which
is why every workspace has a daily cap and audit logging is limited to admin
operations.

### What would you cut first?

In dev: nothing is left to cut — Free tier, one zone, Standard ACR, 1 GB/day
cap, autoscaler minimum of 1. In production: spot instances for a fraction of the
user pool (the workload is stateless and PDB-protected), reserved instances for
the steady-state baseline, and a shorter log retention with archive to storage
for anything older than 30 days.

---

## The honest answers

### What is this project not?

It has never been applied to a live subscription. Everything is validated locally
— Terraform, Helm, kubeconform, promtool, the test suite and four scanners — but
no resource has been created, and `DEPLOYMENT_STATUS.md` says so explicitly. The
numbers in the cost and DR sections are estimates and targets, labelled as such.

### What would you change with more time?

In order: GitOps reconciliation with Argo CD (push-based Helm does not correct
drift between deploys), a private cluster with self-hosted runners, digest-pinned
base images with automated bumps, and image signing enforced at admission. The
first is the biggest gap — everything else on that list hardens a boundary, but
GitOps changes how the platform stays correct over time.

### What is the weakest part of the design?

The single-region model. Everything else degrades gracefully; a region outage is
a four-hour rebuild with manual DNS. It is the right trade for this workload's
criticality, but it is the first thing that would have to change for anything
revenue-bearing, and it is the assumption most worth challenging in review.
