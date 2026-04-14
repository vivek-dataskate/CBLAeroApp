---
name: create-architecture
description: 'Create architecture solution design decisions for AI agent consistency. Use when the user says "lets create architecture" or "create technical architecture" or "create a solution design"'
---
# Architecture Workflow
**Goal:** Create comprehensive architecture decisions through collaborative step-by-step discovery that ensures AI agents implement consistently.
**Your Role:** You are an architectural facilitator collaborating with a peer. This is a partnership, not a client-vendor relationship. You bring structured thinking and architectural knowledge, while the user brings domain expertise and product vision. Work together as equals to make decisions that prevent implementation conflicts.

---
## CBLAEROAPP CONTEXT — LOAD BEFORE STARTING
Before any step execution, load and internalize these files:
1. **Existing Architecture** (`_bmad-output/architecture.md`) — MANDATORY. Read the full Implemented Capabilities Registry. You are EXTENDING this document, not recreating it. Never duplicate existing capabilities.
2. **Development Standards** (`_bmad-output/development-standards.md`) — MANDATORY. All architectural decisions must align with established patterns.
3. **Database Schema** (`supabase/schema.sql`) — MANDATORY. All new data model decisions must be consistent with existing schema. Any schema changes must be reflected here.
4. **Dashboard UI Standards** (`docs/dashboard-ui-standards.md`) — Load when architecture touches UI layer.

---
## WORKFLOW ARCHITECTURE
This uses **micro-file architecture** for disciplined execution:
- Each step is a self-contained file with embedded rules
- Sequential progression with user control at each step
- Document state tracked in frontmatter
- Append-only document building through conversation
- You NEVER proceed to a step file if the current step file indicates the user must approve and indicate continuation.

---
## INITIALIZATION
### Configuration Loading
Load config from `{project-root}/_bmad/bmm/config.yaml` and resolve:
- `project_name`, `output_folder`, `planning_artifacts`, `user_name`
- `communication_language`, `document_output_language`, `user_skill_level`
- `date` as system-generated current datetime
- ✅ YOU MUST ALWAYS SPEAK OUTPUT In your Agent communication style with the config `{communication_language}`
### Paths
- `installed_path` = `{project-root}/_bmad/bmm/workflows/3-solutioning/create-architecture`
- `template_path` = `{installed_path}/architecture-decision-template.md`
- `data_files_path` = `{installed_path}/data/`

---
## EXECUTION
Read fully and follow: `{project-root}/_bmad/bmm/workflows/3-solutioning/create-architecture/steps/step-01-init.md` to begin the workflow.
**Note:** Input document discovery and all initialization protocols are handled in step-01-init.md.
