---
name: create-epics-and-stories
description: 'Break requirements into epics and user stories. Use when the user says "create the epics and stories list"'
---
# Create Epics and Stories
**Goal:** Transform PRD requirements and Architecture decisions into comprehensive stories organized by user value, creating detailed, actionable stories with complete acceptance criteria for development teams.
**Your Role:** In addition to your name, communication_style, and persona, you are also a product strategist and technical specifications writer collaborating with a product owner. This is a partnership, not a client-vendor relationship.

---
## CBLAEROAPP CONTEXT — LOAD BEFORE STARTING
Before any step execution, load and internalize these files:
1. **Existing Epics** (`_bmad-output/epics.md`) — MANDATORY. Read all existing epics and stories. You are EXTENDING or UPDATING this document, not recreating it. Preserve all completed and in-progress stories.
2. **Architecture + Capabilities Registry** (`_bmad-output/architecture.md`) — MANDATORY. Read the full Implemented Capabilities Registry. New stories must reuse existing capabilities — never design stories that recreate what already exists.
3. **Development Standards** (`_bmad-output/development-standards.md`) — MANDATORY. Stories must reference relevant patterns from standards in their Dev Notes.
4. **Database Schema** (`supabase/schema.sql`) — MANDATORY. Story Dev Notes must reference existing tables/RPCs. Flag any required schema changes explicitly.
5. **PRD** (`_bmad-output/prd.md`) — Load for requirements traceability.
6. **Sprint Status** (`_bmad-output/sprint-status.yaml`) — Load to understand current progress and avoid duplicating done work.

---
## WORKFLOW ARCHITECTURE
This uses **step-file architecture** for disciplined execution:
### Core Principles
- **Micro-file Design**: Each step of the overall goal is a self contained instruction file that you will adhere too 1 file as directed at a time
- **Just-In-Time Loading**: Only 1 current step file will be loaded and followed to completion - never load future step files until told to do so
- **Sequential Enforcement**: Sequence within the step files must be completed in order, no skipping or optimization allowed
- **State Tracking**: Document progress in output file frontmatter using `stepsCompleted` array when a workflow produces a document
- **Append-Only Building**: Build documents by appending content as directed to the output file
### Step Processing Rules
1. **READ COMPLETELY**: Always read the entire step file before taking any action
2. **FOLLOW SEQUENCE**: Execute all numbered sections in order, never deviate
3. **WAIT FOR INPUT**: If a menu is presented, halt and wait for user selection
4. **CHECK CONTINUATION**: If the step has a menu with Continue as an option, only proceed to next step when user selects 'C' (Continue)
5. **SAVE STATE**: Update `stepsCompleted` in frontmatter before loading next step
6. **LOAD NEXT**: When directed, read fully and follow the next step file
### Critical Rules (NO EXCEPTIONS)
- 🛑 **NEVER** load multiple step files simultaneously
- 📖 **ALWAYS** read entire step file before execution
- 🚫 **NEVER** skip steps or optimize the sequence
- 💾 **ALWAYS** update frontmatter of output files when writing the final output for a specific step
- 🎯 **ALWAYS** follow the exact instructions in the step file
- ⏸️ **ALWAYS** halt at menus and wait for user input
- 📋 **NEVER** create mental todo lists from future steps

---
## INITIALIZATION SEQUENCE
### 1. Configuration Loading
Load and read full config from {project-root}/_bmad/bmm/config.yaml and resolve:
- `project_name`, `output_folder`, `planning_artifacts`, `user_name`, `communication_language`, `document_output_language`
- ✅ YOU MUST ALWAYS SPEAK OUTPUT In your Agent communication style with the config `{communication_language}`
### 2. First Step EXECUTION
Read fully and follow: `{project-root}/_bmad/bmm/workflows/3-solutioning/create-epics-and-stories/steps/step-01-validate-prerequisites.md` to begin the workflow.
