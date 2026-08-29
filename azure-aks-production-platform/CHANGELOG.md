# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-28

Initial reference implementation.

### Infrastructure

- Terraform modules for networking, AKS, ACR, Key Vault, monitoring and alerts,
  composed by a single `platform` module used by all three environments.
- AKS with Azure CNI Overlay, Cilium network policy, workload identity, Entra ID
  RBAC with local accounts disabled, and separate system/user node pools.
- Segmented VNet: system, user, ingress and private-endpoint subnets, each with
  its own NSG; private DNS zones for ACR and Key Vault private endpoints.
- ACR with admin account disabled; `AcrPull` for the kubelet identity and
  `AcrPush` for the CI federated identity.
- Key Vault with RBAC authorization, environment-scoped purge protection and
  `AuditEvent` diagnostic logging.
- Log Analytics, Azure Monitor workspace for managed Prometheus (with the Data
  Collection Rule, endpoint and cluster association that make metrics actually
  flow), Managed Grafana, and a shared action group.
- `dev`, `staging` and `prod` environment roots with per-environment sizing,
  hardening and alert thresholds; remote-state bootstrap script.

### Application and packaging

- FastAPI service exposing `/`, `/health`, `/ready` and `/metrics`, with
  structured JSON logging and a drain-aware shutdown path.
- Multi-stage Dockerfile: non-root UID 10001, read-only root filesystem, no build
  toolchain in the runtime image.
- Helm chart with probes (liveness, readiness, startup), HPA with scaling
  behaviour, PDB, topology spread, NetworkPolicy, ConfigMap checksum rollout and
  a Key Vault `SecretProviderClass`; `dev`/`staging`/`prod` values overlays.
- Cluster bootstrap manifests: namespaces with Pod Security Admission, resource
  quotas, limit ranges, default-deny NetworkPolicy and namespace RBAC.

### CI/CD

- `terraform-ci` (fmt, validate, plan with PR comment), `app-ci` (ruff, pytest
  with coverage gate, image build and smoke test, Helm lint and kubeconform),
  `cd` (build once, promote dev → staging → production with an environment
  approval gate) and `security` (Checkov, Trivy, pip-audit, Gitleaks).
- Composite `helm-deploy` action shared by all three deployment jobs.

### Observability

- 13 Prometheus rules (recording rules plus application, workload and node
  alerts) and 7 Azure Monitor alert rules.
- 12-panel Grafana dashboard with rollout annotations.
- Managed-Prometheus scrape configuration.

### Documentation

- README, architecture, security, observability, operations runbook, disaster
  recovery and interview notes.
- `DEPLOYMENT_STATUS.md` distinguishing locally validated components from those
  requiring an Azure subscription, and `docs/dev-validation.md` with the
  cost-minimised dev deployment, validation checklist, evidence capture and
  teardown procedure.
- Checkov and Trivy baselines with a written justification for every accepted
  finding.

[1.0.0]: https://github.com/Mikeinc80/azure-aks-production-platform/releases/tag/v1.0.0
