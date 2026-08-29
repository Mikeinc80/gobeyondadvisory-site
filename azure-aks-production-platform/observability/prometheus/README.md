# Prometheus assets

| File | Purpose |
| --- | --- |
| [`alert-rules.yaml`](alert-rules.yaml) | `PrometheusRule` with recording rules for the SLIs and 13 alerts across application, workload and node scopes. |
| [`scrape-config.yaml`](scrape-config.yaml) | Scrape configuration for Azure Monitor managed Prometheus, which does not read `ServiceMonitor` CRDs. |

Two collection paths are supported, and the choice is an either/or:

* **Azure Monitor managed Prometheus** (what the Terraform provisions). Targets come
  from the ConfigMap in `scrape-config.yaml`; alerts are authored as Prometheus rule
  groups in Azure Monitor.
* **Self-hosted kube-prometheus-stack.** Set `serviceMonitor.enabled=true` in the Helm
  values and apply `alert-rules.yaml` as-is.

Each alert carries a `runbook_url` pointing at the matching section of
[`docs/operations-runbook.md`](../../docs/operations-runbook.md) in this
repository, so a page links straight to a procedure. If you fork the repository
under a different owner, repoint them:

```bash
sed -i 's|github.com/Mikeinc80/|github.com/<your-owner>/|g' alert-rules.yaml
```

Validate changes locally with:

```bash
promtool check rules alert-rules.yaml
```
