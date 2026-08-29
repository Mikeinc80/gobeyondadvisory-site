# Contributing

## Local checks

Run these before opening a pull request; they are the same checks CI runs, so a
clean local run means a green pipeline.

```bash
# Terraform: formatting and validity across every module and environment
terraform fmt -check -recursive terraform/
for dir in terraform/modules/*/ terraform/environments/*/; do
  terraform -chdir="$dir" init -backend=false -input=false
  terraform -chdir="$dir" validate
done

# Application
cd app
pip install -r requirements-dev.txt
ruff check . && ruff format --check .
pytest --cov=app --cov-report=term-missing --cov-fail-under=85
cd ..

# Helm: lint every overlay, then schema-validate the rendered output
for env in dev staging prod; do
  helm lint charts/platform-api -f "charts/platform-api/values-$env.yaml" \
    --set image.repository=example.azurecr.io/platform-api --set image.tag=local
  helm template platform-api charts/platform-api \
    -f "charts/platform-api/values-$env.yaml" \
    --set image.repository=example.azurecr.io/platform-api --set image.tag=local \
    | kubeconform -strict -summary -ignore-missing-schemas -kubernetes-version 1.31.0
done
kubeconform -strict -summary -kubernetes-version 1.31.0 k8s/bootstrap

# Security
checkov --config-file .checkov.yaml
trivy config --ignorefile .trivyignore .

# Prometheus rules
promtool check rules <(yq '.spec' observability/prometheus/alert-rules.yaml)
```

## Conventions

**Terraform.** Every variable needs a `description`; add a `validation` block
wherever an invalid value would fail late (during apply) rather than early.
Outputs are for values another module or a human actually consumes — not
everything a resource exposes. Modules do not create resource groups or set
`provider` blocks; the composition module owns both.

**Helm.** Values are the only place environment differences live. If a template
needs an `if` on the environment name, that is a signal the value should be an
input instead.

**Python.** Ruff governs style; the configuration is in `pyproject.toml`. Tests
assert behaviour, not implementation — the readiness tests exercise the lifespan
rather than poking at the flag.

**Commits.** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`,
`refactor:`). One logical change per commit.

## What a good pull request looks like

- The Terraform plan comment shows only the changes you intended.
- New infrastructure carries the standard tags (they come from the composition
  module — if a resource is missing them, it is not going through the module).
- A security suppression, if any, is added to `.checkov.yaml` or `.trivyignore`
  **with a written justification and what would remove it**. A suppression
  without a reason will be rejected.
- Documentation is updated in the same change when behaviour or an interface
  changes.

## Never commit

Real subscription IDs, tenant IDs, object IDs, secrets, `terraform.tfvars`,
`backend.hcl`, kubeconfigs, or `.tfstate`. Gitleaks runs on full history — but it
is a backstop, not the control.
