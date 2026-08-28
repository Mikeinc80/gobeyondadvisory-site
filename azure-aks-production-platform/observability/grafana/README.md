# Grafana

`platform-overview-dashboard.json` is the service overview: SLIs (rate, errors,
latency), workload health (ready replicas, restarts) and cluster capacity, with
rollouts drawn as annotations so "did the deploy cause this?" is answerable at a
glance.

Import it into Azure Managed Grafana (whose endpoint is a Terraform output) or
any Grafana with a Prometheus data source:

```bash
# Portal: Dashboards -> New -> Import -> Upload JSON file
# Or via the API, against a Grafana you can authenticate to:
curl -sS -X POST "$GRAFANA_URL/api/dashboards/db" \
  -H "Authorization: Bearer $GRAFANA_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq '{dashboard: ., overwrite: true}' platform-overview-dashboard.json)"
```

The dashboard takes its data source from a `${datasource}` template variable, so
it works against managed Prometheus or a self-hosted one without editing panels.
`$namespace` and `$deployment` variables scope every panel to one environment.

Series the panels depend on:

| Source | Metrics |
| --- | --- |
| The application (`/metrics`) | `http_requests_total`, `http_request_duration_seconds_bucket`, `app_ready`, `app_build_info` |
| kube-state-metrics | `kube_deployment_status_replicas*`, `kube_pod_container_status_restarts_total`, `kube_node_status_condition` |
| cAdvisor / kubelet | `container_cpu_usage_seconds_total`, `container_memory_working_set_bytes`, `container_cpu_cfs_throttled_periods_total` |
| node-exporter | `node_cpu_seconds_total`, `node_memory_*` |

Azure Monitor managed Prometheus ships kube-state-metrics and cAdvisor targets by
default; node-exporter series require the add-on's node-exporter targets to be
enabled.
