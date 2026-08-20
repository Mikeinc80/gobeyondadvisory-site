output "environment_mode" {
  value       = var.environment_mode
  description = "The mode this deployment runs in. Read once by the service at start-up and frozen."
}

output "release_gates_met" {
  value       = length([for met in values(var.release_gates) : met if met])
  description = "How many of the nine gates are met. Live money requires all nine."
}

output "live_funds_reachable" {
  value       = false
  description = <<-EOT
    Always false in this build.

    assertLiveMoneyPermitted() throws unconditionally regardless of configuration, so this
    output cannot become true by changing a variable. It becomes true only when that code
    changes, which is a review, not a deploy.
  EOT
}

output "data_residency_claim" {
  value       = "NONE. No region selected (FD-008) and no residency claim is made."
  description = "Stated as an output so a deployment cannot quietly imply one."
}
