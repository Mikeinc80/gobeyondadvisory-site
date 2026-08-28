# Security policy

## Scope

This is a reference implementation. It provisions real Azure resources and grants
real permissions when applied, so security issues in it matter even though it
runs no production service.

## Reporting a vulnerability

Report privately via GitHub's **Security → Report a vulnerability** (private
vulnerability reporting). Please do not open a public issue for an unpatched
issue.

Useful report contents: the file and line, what an attacker gains, and — where
you have one — a suggested fix.

Expect an acknowledgement within 5 working days.

## What counts as a vulnerability here

In scope:

- Over-permissive Azure role assignments or Kubernetes RBAC
- Credentials, keys or tokens committed to the repository
- Container or Kubernetes configuration allowing privilege escalation or host
  access
- CI/CD configuration allowing a fork or an untrusted contributor to obtain
  secrets, push an image, or deploy
- Network configuration exposing something that should be internal

Out of scope:

- Findings already listed with justification in [`.checkov.yaml`](.checkov.yaml)
  or [`.trivyignore`](.trivyignore) — if you disagree with a justification, that
  is a valid issue, so say why
- Unfixed CVEs in upstream base images, which are handled by the weekly scan and
  a base-image bump
- Deliberate non-production defaults in the `dev` environment, which are
  documented in [docs/security.md](docs/security.md)

## Security posture of this repository

Every push and pull request is scanned by Checkov (Terraform), Trivy (image and
IaC), pip-audit (dependencies) and Gitleaks (secrets), and the same suite runs
weekly on a schedule. Results appear in the repository's Security tab.

The design itself — threat model, identity architecture, accepted risks — is
documented in [docs/security.md](docs/security.md).
