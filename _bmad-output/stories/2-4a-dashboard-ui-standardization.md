# Story 2.4a: Dashboard UI Standardization

Status: done

## Story

As a recruiter, admin, or delivery head,
I want all dashboard screens to have a consistent, clean visual design with white backgrounds, readable fonts, and uniform navigation,
so that the application feels professional and I can navigate confidently across all sections.

## Acceptance Criteria

1. **Given** any dashboard page (`/dashboard/**`)
   **When** the page renders
   **Then** the page background is white (`bg-white`), not dark or gray

2. **Given** any dashboard page
   **When** the header renders
   **Then** it is sticky (`sticky top-0`), has a bottom border, and contains breadcrumb navigation at `text-base` (16px) font size with emerald-colored links and `/` separators

3. **Given** any dashboard page
   **When** the page renders
   **Then** a consistent footer is displayed with "CBL Aero · Enterprise Portal" text

4. **Given** any dashboard page
   **When** content is displayed
   **Then** all content is contained within a `max-w-6xl` centered container with `px-6` horizontal padding

5. **Given** any text element on a dashboard page
   **When** rendered
   **Then** no font size smaller than `text-xs` (12px) is used, and no arbitrary pixel values like `text-[10px]` appear

6. **Given** any dashboard page
   **When** colors are applied
   **Then** `gray-*` is used for all neutral colors (never `slate-*`) and `emerald-*` for accent colors (never `cyan-*`)

7. **Given** any card or section container on a dashboard page
   **When** rendered
   **Then** cards use `rounded-xl` (12px) border radius, buttons use `rounded-lg` (8px), and badges use `rounded-full`

8. **Given** the dashboard UI standards document
   **When** a developer references it
   **Then** it is available at `cblaero/docs/dashboard-ui-standards.md` with complete specifications for layout, typography, colors, cards, buttons, forms, tables, loading states, and empty states

9. **Given** the development standards and architecture documents
   **When** a dev agent or code reviewer loads them
   **Then** §27 in development-standards.md references the dashboard UI standards as a code review gate, and architecture.md includes a Dashboard UI Standards subsection

10. **Given** the code-review, dev-story, and create-story workflows
    **When** a story touches `src/app/dashboard/`
    **Then** the dashboard-ui-standards.md is loaded as an input and compliance is validated

## Tasks

- [x] Task 1: Update globals.css — remove dark mode, standardize foreground color
- [x] Task 2: Standardize Dashboard page (`/dashboard`) — white bg, sticky header, breadcrumbs, footer
- [x] Task 3: Standardize Admin Console page (`/dashboard/admin`) — breadcrumb nav, consistent cards, footer
- [x] Task 4: Standardize Dedup Review page (`/dashboard/admin/dedup`) — breadcrumb nav, white bg, larger stats, footer
- [x] Task 5: Standardize Candidate Search page (`/dashboard/recruiter/candidates`) — breadcrumb nav, white bg, footer
- [x] Task 6: Standardize Candidate Detail page (`/dashboard/recruiter/candidates/[id]`) — full breadcrumb trail, light hero, footer
- [x] Task 7: Standardize Upload page (`/dashboard/recruiter/upload`) — breadcrumb nav, consistent layout, footer
- [x] Task 8: Normalize all admin components (AdminGovernanceConsole, AiCostDashboard, SyncErrorStatusCard, MigrationStatusCard) — font sizes from `text-[9-12px]` to `text-xs`/`text-sm`
- [x] Task 9: Normalize upload components (UploadModeSelector, CsvUploadWizard, ResumeUploadWizard, BatchProgressCard) — slate→gray, font normalization
- [x] Task 10: Create `cblaero/docs/dashboard-ui-standards.md` — complete reference doc
- [x] Task 11: Add §27 to development-standards.md with quick-reference rules and trigger condition
- [x] Task 12: Add Dashboard UI Standards subsection to architecture.md under UI Components
- [x] Task 13: Add 8-point UI compliance check to code-review workflow instructions.xml
- [x] Task 14: Add dashboard_ui_standards as SELECTIVE_LOAD input to code-review, dev-story, and create-story workflow.yaml files
- [x] Task 15: Add conditional action to dev-story instructions.xml Step 2 for dashboard stories
- [x] Task 16: Add story 2-4a to epics.md, sprint-status.yaml, and update all planning artifacts

## Dev Notes

### Dependencies
- Story 2.4 (Candidate Profile Storage and Indexing) — must be done first as it created the candidate search and detail pages

### Design Decisions
- **Landing page excluded**: The login page (`/`) retains its branded dark theme — it's not a dashboard page
- **Emerald as primary accent**: Chosen for professional feel and good contrast on white backgrounds
- **gray-* over slate-***: Warmer, more consistent neutrals across all pages
- **text-base breadcrumbs**: 16px provides clear wayfinding without dominating the header
- **max-w-6xl container**: Wide enough for data-dense admin tables, narrow enough for comfortable reading
- **No dark mode**: Enterprise internal tool — single light theme reduces maintenance and ensures consistent experience

### Files Changed

#### Page files (7 pages)
- `src/app/globals.css`
- `src/app/dashboard/page.tsx`
- `src/app/dashboard/admin/page.tsx`
- `src/app/dashboard/admin/dedup/page.tsx`
- `src/app/dashboard/recruiter/candidates/page.tsx`
- `src/app/dashboard/recruiter/candidates/[id]/page.tsx`
- `src/app/dashboard/recruiter/upload/page.tsx`

#### Component files (8 components)
- `src/app/dashboard/admin/AdminGovernanceConsole.tsx`
- `src/app/dashboard/admin/AiCostDashboard.tsx`
- `src/app/dashboard/admin/SyncErrorStatusCard.tsx`
- `src/app/dashboard/admin/MigrationStatusCard.tsx`
- `src/app/dashboard/recruiter/upload/UploadModeSelector.tsx`
- `src/app/dashboard/recruiter/upload/CsvUploadWizard.tsx`
- `src/app/dashboard/recruiter/upload/ResumeUploadWizard.tsx`
- `src/app/dashboard/recruiter/upload/BatchProgressCard.tsx`

#### Standards & documentation
- `cblaero/docs/dashboard-ui-standards.md` (new)
- `docs/planning_artifacts/development-standards.md` (§27 added)
- `docs/planning_artifacts/architecture.md` (UI Standards subsection added)
- `docs/planning_artifacts/prd.md` (dashboard visual standards callout added)
- `docs/planning_artifacts/ux-design-specification.md` (Dashboard Visual Design System section added)
- `docs/planning_artifacts/epics.md` (Story 2.4a entry added)
- `docs/implementation_artifacts/sprint-status.yaml` (2-4a status added)

#### Workflow files
- `src/bmm/workflows/4-implementation/code-review/workflow.yaml`
- `src/bmm/workflows/4-implementation/code-review/instructions.xml`
- `src/bmm/workflows/4-implementation/dev-story/workflow.yaml`
- `src/bmm/workflows/4-implementation/dev-story/instructions.xml`
- `src/bmm/workflows/4-implementation/create-story/workflow.yaml`

### Key Patterns Applied

| Before | After |
|---|---|
| `text-[9px]`, `text-[10px]`, `text-[11px]` | `text-xs` (12px), `text-sm` (14px) |
| Breadcrumbs at `text-xs` (10-12px) | `text-base font-medium` (16px) |
| `slate-*` colors | `gray-*` everywhere |
| Mixed `bg-slate-950`, `bg-gray-50` page backgrounds | `bg-white` page level |
| `rounded-lg`, `rounded-2xl`, `rounded-3xl` cards | `rounded-xl` cards, `rounded-lg` buttons |
| No footer | Consistent footer on all pages |
| No shared header pattern | Sticky header with breadcrumbs on all pages |

- [x] Task 17: Standardize all page headers — Sign Out button right side on every page, move page-specific controls (Saved Searches, client switcher) to content area

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-04-08 | Story created and implemented | Dev Agent |
| 2026-04-08 | Header consistency fix: Sign Out on all pages, removed inconsistent Dashboard/Saved Searches buttons from headers | Dev Agent |
