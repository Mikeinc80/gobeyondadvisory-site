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

Before applying `alert-rules.yaml`, replace `REPLACE_ORG` in the `runbook_url`
annotations with your GitHub organisation so the links resolve:

```bash
sed -i 's|REPLACE_ORG|your-org|g' alert-rules.yaml
```

Validate changes locally with:

```bash
promtool check rules alert-rules.yaml
```
