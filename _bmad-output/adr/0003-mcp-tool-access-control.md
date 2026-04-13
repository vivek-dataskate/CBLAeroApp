# ADR-0003: MCP Tool Access Control

- Status: Accepted
- Date: 2026-03-10
- Owners: Architecture, Security, Platform

## Context

MCP-enabled tools can execute sensitive operations across systems. Unrestricted tool invocation creates risk for data exfiltration, unauthorized changes, and compliance gaps.

## Decision

1. All MCP calls must route through a server-side policy gateway.
2. Access is allowlisted by role, tenant scope, and environment.
3. Every MCP invocation must include actor ID, tenant ID, scope, and trace ID.
4. High-risk operations (bulk export, role changes, privileged admin actions) require step-up authentication and explicit approval checks.
5. Default policy is deny; new tools require explicit policy registration.

## Consequences

- Positive: Strong control plane for tool usage and forensic traceability.
- Negative: Adds policy-management overhead and initial integration complexity.

## Verification

- Policy tests for allow and deny paths in CI.
- Audit review can reconstruct all privileged MCP actions by trace ID.
- Unauthorized MCP call attempts generate security alerts.
