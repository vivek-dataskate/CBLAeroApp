---
failed_layers: '' # set at runtime: comma-separated list of layers that failed or returned empty
---

# Step 2: Review

## RULES

- YOU MUST ALWAYS SPEAK OUTPUT in your Agent communication style with the config `{communication_language}`
- The Blind Hunter subagent receives NO project context — diff only.
- The Edge Case Hunter subagent receives diff and project read access.
- The Acceptance Auditor subagent receives diff, spec, and context docs.

## INSTRUCTIONS

1. If `{review_mode}` = `"no-spec"`, note to the user: "Acceptance Auditor skipped — no spec file provided."

2. Launch parallel subagents without conversation context. If subagents are not available, generate prompt files in `{implementation_artifacts}` — one per reviewer role below — and HALT. Ask the user to run each in a separate session (ideally a different LLM) and paste back the findings. When findings are pasted, resume from this point and proceed to step 3.

   - **Blind Hunter** — receives `{diff_output}` only. No spec, no context docs, no project access. Invoke via the `bmad-review-adversarial-general` skill.

   - **Edge Case Hunter** — receives `{diff_output}` and read access to the project. Invoke via the `bmad-review-edge-case-hunter` skill.

   - **Acceptance Auditor** (only if `{review_mode}` = `"full"`) — receives `{diff_output}`, the content of the file at `{spec_file}`, and any loaded context docs. Its prompt:
     > You are an Acceptance Auditor. Review this diff against the spec and context docs. Check for: violations of acceptance criteria, deviations from spec intent, missing implementation of specified behavior, contradictions between spec constraints and actual code. Output findings as a Markdown list. Each finding: one-line title, which AC/constraint it violates, and evidence from the diff.

   - **Cross-Module Flow Auditor** — receives `{diff_output}` and read access to the project. Its prompt:
     > You are a Cross-Module Flow Auditor. For each function or data type changed in this diff, trace how its outputs are consumed by OTHER modules — not just the module being changed. Check for:
     > 1. **Fingerprint/token type mismatches**: Module A records data under type X, but Module B that should detect the same data queries type Y. Example: email ingestion records `email_message_id` but OneDrive checks `file_sha256` — same PDF goes undetected across sources.
     > 2. **Schema drift**: A function's return shape changed but downstream consumers still read old field names.
     > 3. **Shared-state assumptions**: Two modules read/write the same DB table or cache key with incompatible expectations (e.g., one writes status='pending', the other filters on status='active').
     > 4. **Event/callback contract breaks**: A producer emits events or calls callbacks with a different signature than subscribers expect.
     > 5. **Cross-source dedup gaps**: Multiple ingestion paths that can receive the same underlying data (same PDF, same candidate, same record) but use different dedup keys, so duplicates slip through.
     >
     > For each finding: name the producer module, the consumer module, what data flows between them, and what specifically breaks. Ignore issues contained within a single module — those are covered by other reviewers.

3. **Subagent failure handling**: If any subagent fails, times out, or returns empty results, append the layer name to `{failed_layers}` (comma-separated) and proceed with findings from the remaining layers.

4. Collect all findings from the completed layers.


## NEXT

Read fully and follow `./step-03-triage.md`
