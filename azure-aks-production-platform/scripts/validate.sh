#!/usr/bin/env bash
#
# Runs every check that does not need an Azure subscription - the same set CI
# runs. Skips any tool that is not installed rather than failing, so it is
# useful on a partially-provisioned machine, and prints a summary at the end.
#
# Usage: ./scripts/validate.sh

set -uo pipefail

cd "$(dirname "$0")/.."

PASS=0
FAIL=0
SKIP=0

run() {
  local name="$1" tool="$2"
  shift 2
  if ! command -v "${tool}" >/dev/null 2>&1; then
    printf '  SKIP  %s (%s not installed)\n' "${name}" "${tool}"
    SKIP=$((SKIP + 1))
    return
  fi
  if "$@" >/tmp/validate.log 2>&1; then
    printf '  PASS  %s\n' "${name}"
    PASS=$((PASS + 1))
  else
    printf '  FAIL  %s\n' "${name}"
    sed 's/^/        /' /tmp/validate.log | tail -20
    FAIL=$((FAIL + 1))
  fi
}

terraform_validate_all() {
  local dir
  for dir in terraform/modules/*/ terraform/environments/*/; do
    terraform -chdir="${dir}" init -backend=false -input=false -no-color >/dev/null || return 1
    terraform -chdir="${dir}" validate -no-color >/dev/null || return 1
  done
}

helm_lint_all() {
  local env
  for env in dev staging prod; do
    helm lint charts/platform-api \
      -f "charts/platform-api/values-${env}.yaml" \
      --set image.repository=example.azurecr.io/platform-api \
      --set image.tag=validate >/dev/null || return 1
  done
}

helm_render_and_check() {
  local env
  command -v kubeconform >/dev/null 2>&1 || return 0
  for env in dev staging prod; do
    helm template platform-api charts/platform-api \
      -f "charts/platform-api/values-${env}.yaml" \
      --set image.tag=validate \
      --set image.repository=example.azurecr.io/platform-api \
      --set serviceAccount.workloadIdentityClientId=00000000-0000-0000-0000-000000000000 \
      --set keyVault.name=kv-example \
      --set keyVault.tenantId=00000000-0000-0000-0000-000000000000 \
      | kubeconform -strict -summary -ignore-missing-schemas -kubernetes-version 1.31.0 || return 1
  done
}

promtool_check() {
  python3 -c "
import sys, yaml
spec = yaml.safe_load(open('observability/prometheus/alert-rules.yaml'))['spec']
yaml.safe_dump(spec, open('/tmp/promrules.yaml', 'w'))
" || return 1
  promtool check rules /tmp/promrules.yaml
}

yaml_parse_all() {
  python3 - <<'PY'
import pathlib
import sys

import yaml

failures = []
for path in sorted(pathlib.Path(".").rglob("*.y*ml")):
    # Helm templates are Go templates, not YAML, until they are rendered.
    if ".terraform" in path.parts or "templates" in path.parts:
        continue
    try:
        list(yaml.safe_load_all(path.read_text()))
    except yaml.YAMLError as exc:
        failures.append(f"{path}: {exc}")

for failure in failures:
    print(failure)
sys.exit(1 if failures else 0)
PY
}

echo "== Terraform"
run "terraform fmt"        terraform terraform fmt -check -recursive terraform/
run "terraform validate"   terraform terraform_validate_all

echo "== Application"
run "ruff check"           ruff   ruff check app/
run "ruff format"          ruff   ruff format --check app/
run "pytest + coverage"    pytest env -C app pytest --cov=app --cov-fail-under=85

echo "== Kubernetes and Helm"
run "helm lint"            helm       helm_lint_all
run "helm template + kubeconform" helm helm_render_and_check
run "kubeconform bootstrap" kubeconform kubeconform -strict -summary -kubernetes-version 1.31.0 k8s/bootstrap

echo "== Observability"
run "promtool check rules" promtool promtool_check
run "grafana dashboard json" python3 python3 -c "import json; json.load(open('observability/grafana/platform-overview-dashboard.json'))"

echo "== Security"
run "checkov"              checkov checkov --config-file .checkov.yaml --compact --quiet
run "trivy config"         trivy   trivy config --ignorefile .trivyignore --exit-code 1 --severity CRITICAL,HIGH,MEDIUM .

echo "== Misc"
run "yaml parses"          python3 yaml_parse_all
run "shell syntax"         bash    bash -n scripts/bootstrap-remote-state.sh

printf '\n%d passed, %d failed, %d skipped\n' "${PASS}" "${FAIL}" "${SKIP}"
[ "${FAIL}" -eq 0 ]
