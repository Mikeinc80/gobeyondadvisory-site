variable "name_suffix" {
  description = "Suffix applied to every alert rule name."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group holding the alert rules."
  type        = string
}

variable "location" {
  description = "Azure region (scheduled-query rules are regional resources)."
  type        = string
}

variable "cluster_id" {
  description = "AKS cluster resource ID that metric alerts are scoped to."
  type        = string
}

variable "log_analytics_workspace_id" {
  description = "Workspace the log alerts query."
  type        = string
}

variable "action_group_id" {
  description = "Action group notified by every rule."
  type        = string
}

variable "watched_namespaces" {
  description = "Kubernetes namespaces the log alerts cover."
  type        = list(string)
  default     = ["dev", "staging", "production"]
}

variable "thresholds" {
  description = <<-DESC
    Alert thresholds. Defaults are conservative starting points; tune them from
    observed baselines rather than leaving them at these values forever.
  DESC
  type = object({
    node_cpu_percent     = number
    node_memory_percent  = number
    node_disk_percent    = number
    pod_restarts_15m     = number
    unavailable_replicas = number
    failed_events_15m    = number
  })
  default = {
    node_cpu_percent     = 80
    node_memory_percent  = 80
    node_disk_percent    = 80
    pod_restarts_15m     = 3
    unavailable_replicas = 0
    failed_events_15m    = 5
  }
}

variable "tags" {
  description = "Tags applied to every alert rule."
  type        = map(string)
}
