# Azure Monitor alert rules for the cluster.
#
# Two families are used deliberately:
#   * Metric alerts for resource saturation, where Azure already emits a first-
#     class metric and the platform evaluates it for free.
#   * Scheduled-query (log) alerts for Kubernetes-level conditions such as pod
#     restarts and unavailable replicas, which only exist in Container Insights
#     tables.
#
# Every rule points at the shared action group so routing is configured once.
# Thresholds are starting points: they should be re-derived from observed
# baselines once a cluster has real traffic (see docs/observability.md).

locals {
  # Alert severity in Azure Monitor: 0 critical .. 4 verbose.
  sev_critical = 1
  sev_warning  = 2
}

# --- Node saturation ---------------------------------------------------------

resource "azurerm_monitor_metric_alert" "node_cpu" {
  name                = "alert-node-cpu-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  scopes              = [var.cluster_id]
  description         = "Average node CPU above threshold: the cluster is close to being unable to schedule new pods."
  severity            = local.sev_warning
  frequency           = "PT5M"
  window_size         = "PT15M"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.ContainerService/managedClusters"
    metric_name      = "node_cpu_usage_percentage"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = var.thresholds.node_cpu_percent
  }

  action {
    action_group_id = var.action_group_id
  }
}

resource "azurerm_monitor_metric_alert" "node_memory" {
  name                = "alert-node-memory-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  scopes              = [var.cluster_id]
  description         = "Average node working-set memory above threshold: eviction and OOMKill risk."
  severity            = local.sev_warning
  frequency           = "PT5M"
  window_size         = "PT15M"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.ContainerService/managedClusters"
    metric_name      = "node_memory_working_set_percentage"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = var.thresholds.node_memory_percent
  }

  action {
    action_group_id = var.action_group_id
  }
}

resource "azurerm_monitor_metric_alert" "node_disk" {
  name                = "alert-node-disk-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  scopes              = [var.cluster_id]
  description         = "Node OS disk usage above threshold: kubelet will start evicting pods under DiskPressure."
  severity            = local.sev_warning
  frequency           = "PT15M"
  window_size         = "PT1H"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.ContainerService/managedClusters"
    metric_name      = "node_disk_usage_percentage"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = var.thresholds.node_disk_percent
  }

  action {
    action_group_id = var.action_group_id
  }
}

# A node that stops reporting Ready is a capacity loss whether or not anything
# has failed yet, so this is the one metric alert at critical severity.
resource "azurerm_monitor_metric_alert" "nodes_not_ready" {
  name                = "alert-nodes-not-ready-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  scopes              = [var.cluster_id]
  description         = "One or more nodes have been NotReady for the evaluation window."
  severity            = local.sev_critical
  frequency           = "PT5M"
  window_size         = "PT15M"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.ContainerService/managedClusters"
    metric_name      = "kube_node_status_condition"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 0

    dimension {
      name     = "condition"
      operator = "Include"
      values   = ["Ready"]
    }

    dimension {
      name     = "status"
      operator = "Include"
      values   = ["false", "unknown"]
    }
  }

  action {
    action_group_id = var.action_group_id
  }
}

# --- Workload health ---------------------------------------------------------

# Restart spikes: CrashLoopBackOff, OOMKills and failing liveness probes all show
# up here first, usually before users notice.
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "pod_restart_spike" {
  name                = "alert-pod-restarts-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  scopes              = [var.log_analytics_workspace_id]
  description         = "Container restarts in a namespace exceeded the threshold over 15 minutes."
  severity            = local.sev_warning
  enabled             = true
  tags                = var.tags

  evaluation_frequency = "PT5M"
  window_duration      = "PT15M"

  criteria {
    # restartCount is cumulative per container, so the delta across the window
    # is what indicates a spike rather than a pod that restarted once last week.
    query                   = <<-KQL
      KubePodInventory
      | where TimeGenerated > ago(15m)
      | where Namespace in (${join(", ", formatlist("'%s'", var.watched_namespaces))})
      | summarize Restarts = max(ContainerRestartCount) - min(ContainerRestartCount)
          by Namespace, ContainerName
      | where Restarts > 0
      | summarize AggregatedValue = sum(Restarts) by Namespace
    KQL
    time_aggregation_method = "Maximum"
    metric_measure_column   = "AggregatedValue"
    threshold               = var.thresholds.pod_restarts_15m
    operator                = "GreaterThan"

    dimension {
      name     = "Namespace"
      operator = "Include"
      values   = ["*"]
    }

    failing_periods {
      minimum_failing_periods_to_trigger_alert = 1
      number_of_evaluation_periods             = 1
    }
  }

  action {
    action_groups = [var.action_group_id]
  }
}

# Replicas short of desired for a sustained period. Catches failed rollouts,
# unschedulable pods and quota exhaustion with one rule.
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "unavailable_replicas" {
  name                = "alert-unavailable-replicas-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  scopes              = [var.log_analytics_workspace_id]
  description         = "A deployment has been running below its desired replica count for 10 minutes."
  severity            = local.sev_critical
  enabled             = true
  tags                = var.tags

  evaluation_frequency = "PT5M"
  window_duration      = "PT10M"

  criteria {
    query                   = <<-KQL
      KubePodInventory
      | where TimeGenerated > ago(10m)
      | where Namespace in (${join(", ", formatlist("'%s'", var.watched_namespaces))})
      | where ControllerKind == 'ReplicaSet'
      | summarize Ready = dcountif(Name, PodStatus == 'Running'), Total = dcount(Name)
          by Namespace, ControllerName
      | extend AggregatedValue = Total - Ready
      | where AggregatedValue > 0
    KQL
    time_aggregation_method = "Maximum"
    metric_measure_column   = "AggregatedValue"
    threshold               = var.thresholds.unavailable_replicas
    operator                = "GreaterThan"

    dimension {
      name     = "Namespace"
      operator = "Include"
      values   = ["*"]
    }

    failing_periods {
      # Two consecutive failing periods: a rolling update legitimately dips
      # below desired for a few seconds, and paging on that is noise.
      minimum_failing_periods_to_trigger_alert = 2
      number_of_evaluation_periods             = 2
    }
  }

  action {
    action_groups = [var.action_group_id]
  }
}

# Image pull failures and scheduling failures - the two ways a deployment fails
# without any container ever running, so no restart or CPU signal would fire.
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "failed_deployment" {
  name                = "alert-failed-deployment-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  scopes              = [var.log_analytics_workspace_id]
  description         = "Pods are failing to start (ImagePullBackOff, CreateContainerError or unschedulable)."
  severity            = local.sev_critical
  enabled             = true
  tags                = var.tags

  evaluation_frequency = "PT5M"
  window_duration      = "PT15M"

  criteria {
    query                   = <<-KQL
      KubeEvents
      | where TimeGenerated > ago(15m)
      | where Namespace in (${join(", ", formatlist("'%s'", var.watched_namespaces))})
      | where KubeEventType == 'Warning'
      | where Reason in ('Failed', 'FailedCreate', 'FailedScheduling', 'BackOff', 'FailedMount')
      | summarize AggregatedValue = count() by Namespace
    KQL
    time_aggregation_method = "Total"
    metric_measure_column   = "AggregatedValue"
    threshold               = var.thresholds.failed_events_15m
    operator                = "GreaterThan"

    dimension {
      name     = "Namespace"
      operator = "Include"
      values   = ["*"]
    }

    failing_periods {
      minimum_failing_periods_to_trigger_alert = 1
      number_of_evaluation_periods             = 1
    }
  }

  action {
    action_groups = [var.action_group_id]
  }
}
