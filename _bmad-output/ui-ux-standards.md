# CBLAero — UI & UX Standards

Canonical source for: brand tokens, dashboard layout contract, reusable component inventory, accessibility rules, and page-type conventions. Merged from prior `ux-design-specification.md` and `dashboard-ui-standards.md` (archives at `_bmad-output/ux-design-specification.full.md` and `_bmad-output/dashboard-ui-standards.full.md`). For component file paths, see `_bmad-output/architecture.md` §UI Components (Reusable).

---

## Design Direction

CBLAero is an enterprise recruiter operations portal. The UX inverts traditional recruiting: instead of a database-search tool, it is an **action stream** — a prioritized worklist of candidates ranked by motivation intensity (response speed, questions asked, volunteered start date). The recruiter dashboard leads with "Call Today" rows and progressive disclosure for larger cohorts, so the same layout scales from 5 to 50 candidates without redesign.

Brand voice is **professional, transparent, calm**. The primary user (Mike, recruiter) needs at-a-glance trust in the system — match reasons, qualification transcripts, and auto-booked call slots visible on the candidate card. The secondary surface is a candidate-facing "do-not-disturb control panel" (opt-in, contact windows, revocation), which exists outside `/dashboard` and has its own branded design. Admin surfaces (Elena, Alex) favor observability — status badges, last-run timestamps, "Run Now" controls — over heavy configuration UIs.

The visual system is **single light theme, white backgrounds, navy+blue accent**. No dark mode. Minimum 12px type. Dashboard pages are internal tools — density and scanability trump decorative polish.

---

## Brand Tokens

Custom brand colors are defined in `globals.css` as CSS variables and registered in Tailwind's `@theme inline` block.

| Token | Hex | Tailwind Class | Usage |
|---|---|---|---|
| Navy | `#1a174d` | `cbl-navy` | Header bg, primary buttons, headings, primary links |
| Blue | `#1d87c8` | `cbl-blue` | Hover states, accents, progress bars, focus rings |
| Dark | `#101218` | `cbl-dark` | Footer background |
| Light | `#F3F5F5` | `cbl-light` | Text on dark backgrounds (header/footer) |

**Font**: Poppins (Google Fonts), falling back to Segoe UI, Aptos, sans-serif.

### Type Scale (Tailwind standard classes only — never arbitrary `text-[Npx]`)

| Use | Class | Size |
|---|---|---|
| Page title / stat value | `text-xl font-bold` | 20px |
| Breadcrumbs, nav links | `text-base font-medium` | 16px |
| Body, form labels, table cells | `text-sm` | 14px |
| Button text | `text-sm font-medium` | 14px |
| Section headers | `text-xs font-semibold uppercase tracking-wide` | 12px |
| Small buttons, timestamps, aux labels | `text-xs` | 12px |

### Neutral & Status Colors

| Use | Class |
|---|---|
| Primary text | `text-gray-900` |
| Secondary text | `text-gray-700` |
| Muted text | `text-gray-500` |
| Placeholder / aux | `text-gray-400` |
| Success / Active | `bg-green-100 text-green-700` |
| Warning / Passive | `bg-yellow-100 text-yellow-700` |
| Error / Unavailable | `bg-red-100 text-red-700` |
| Info | `bg-blue-100 text-blue-700` |
| Neutral | `bg-gray-100 text-gray-500` |

**Color namespace rules**: use `gray-*` for neutrals (never `slate-*`). Use `cbl-navy`/`cbl-blue`/`cbl-dark`/`cbl-light` for brand accent (never `emerald-*` or `cyan-*` on dashboard pages). Use `red-*` for errors (prefer over `rose-*`).

### Radius & Spacing

| Element | Radius | | Element | Spacing |
|---|---|---|---|---|
| Cards, sections, modals | `rounded-xl` (12px) | | Header | `px-6 py-4` |
| Buttons, inputs | `rounded-lg` (8px) | | Card padding | `p-5` |
| Badges / pills | `rounded-full` | | Section gap | `mt-4` / `mt-6` |
| — | — | | Grid gap | `gap-4` / `gap-3` |

Never use `rounded-2xl`, `rounded-3xl`, or `rounded-md` on dashboard cards.

---

## Dashboard Layout Contract

Every `/dashboard/**` page uses the same flex column skeleton: sticky header + flex-1 main + footer, on a white page.

```tsx
<div className="flex min-h-screen flex-col bg-white">
  <header className="sticky top-0 z-10 bg-cbl-navy shadow-md">
    <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
      <nav className="flex items-center gap-2 text-base font-medium">
        <Link href="/dashboard" className="text-cbl-light hover:text-white">Dashboard</Link>
        <span className="text-cbl-light/40">/</span>
        <span className="text-white">Current Page</span>
      </nav>
      {/* Sign Out button only — no page-specific controls in header */}
    </div>
  </header>

  <main className="mx-auto max-w-6xl w-full flex-1 px-6 py-6">
    {/* Page content */}
  </main>

  <footer className="bg-cbl-dark">
    <div className="mx-auto max-w-6xl px-6 py-4">
      <p className="text-sm text-cbl-light/60">CBL Aero &middot; Enterprise Portal</p>
    </div>
  </footer>
</div>
```

Rules:
- **Container width**: `max-w-6xl mx-auto px-6` on most pages. Admin Console is the exception (`w-full px-6`) because its 2x2 data-dense grid needs horizontal space.
- **Backgrounds**: page is always `bg-white`; primary cards are `bg-white` with `border border-gray-200 rounded-xl`; muted panels inside cards use `bg-gray-50`.
- **Header right side is Sign Out only** — put Saved Searches, client switcher, etc. in the content area.
- **Landing / login page** (`/`) is excluded from this contract; it has its own branded design.

---

## Component Inventory (Reusable)

UX-focused descriptions below. File paths live in `_bmad-output/architecture.md` §UI Components (Reusable).

| Component | Purpose |
|---|---|
| **Primary Card** | `rounded-xl border border-gray-200 bg-white p-5`. The default content container. |
| **Stat Card** | Same chrome on `bg-gray-50`; `text-xs` uppercase label + `text-sm font-medium` value. |
| **CollapsibleCard** | Full-width clickable header with chevron (rotates 180° on open). `defaultOpen` prop controls initial state. Child components **must not** render their own `<h3>` — the card title replaces it. Used on admin pages to organize multi-module screens. |
| **Info / Alert Banner** | `rounded-xl border border-cbl-blue/30 bg-cbl-blue/10 p-5 text-sm text-cbl-navy`. |
| **Error Banner** | `rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700`. |
| **Primary Button** | `bg-cbl-navy text-white hover:bg-cbl-blue`, `rounded-lg px-4 py-2 text-sm font-medium`, `disabled:opacity-50`. |
| **Secondary Button** | `border border-gray-300 text-gray-700 hover:bg-gray-50`, same shape. |
| **Small Button** | `text-xs font-medium`, `px-3 py-1.5`, `border border-gray-300 text-gray-600 hover:bg-gray-100`. |
| **Input / Select** | `rounded-lg border border-gray-300 px-3 py-2 text-sm`, focus: `border-cbl-blue ring-1 ring-cbl-blue`. Label: `text-xs font-medium text-gray-600`. |
| **Table** | `w-full text-left`; `<thead>` row: `border-b border-gray-100 bg-gray-50/50`, headers `text-xs font-semibold uppercase tracking-wider text-gray-500`; rows: `text-sm text-gray-700 hover:bg-cbl-blue/5`, body `divide-y divide-gray-100`. |
| **Loading State** | Centered spinner: `h-8 w-8 animate-spin rounded-full border-2 border-cbl-navy border-t-transparent` + `text-sm text-gray-500` caption. |
| **Empty State** | `rounded-xl border border-gray-200 bg-gray-50 py-16 text-center` with primary + helper line. |

---

## Accessibility

Project-specific rules (these override defaults):

- **Minimum readable size is 12px (`text-xs`)** — never use smaller. No `text-[10px]` / `text-[9px]`.
- **Focus rings are required on all inputs, selects, and buttons** — use `focus:ring-1 focus:ring-cbl-blue` (inputs) or rely on browser default on buttons; do not suppress outlines.
- **Color is not the only signal** — status badges pair background+foreground pairs (e.g. `bg-green-100 text-green-700`), and critical status also has a text label, not just a dot.
- **Active breadcrumb is not a link** (`text-white`); prior crumbs are links with `text-cbl-light hover:text-white`.
- **Keyboard-reachable collapsibles**: `CollapsibleCard` headers are `<button>` elements; chevron rotation is the visible affordance.
- **Dashboard is single-theme light** — no dark-mode class toggles; ensures WCAG AA contrast is validated once.

---

## Page-Type Conventions

| Page type | Route pattern | Layout | Nav | Access |
|---|---|---|---|---|
| **Public / candidate** | `/`, `/opt-in/*`, `/portal/*` | Branded landing + CBL marketing chrome; **not** subject to the dashboard layout contract. | Public marketing nav. | Unauthenticated or UUID-token link. |
| **Recruiter dashboard** | `/dashboard`, `/dashboard/candidates`, `/dashboard/jobs`, `/dashboard/uploads` | Layout contract above, `max-w-6xl`. Action-stream-first: top 5 rich candidate cards + "Show more" progressive disclosure. | Breadcrumbs in header; page-specific controls (client switcher, saved searches) in content area. | Auth + `activeClientId`; role `recruiter` or `admin`. |
| **Admin console** | `/dashboard/admin/**` | Layout contract, but `w-full px-6` container. 2x2 `CollapsibleCard` grid on desktop, stacked on mobile. | Breadcrumbs + Sign Out only. | Role `admin`. |

### Admin Console grid (`/dashboard/admin`)

```
┌──────────────────────┬──────────────────────┐
│  Scheduler Status    │  Sync Runs           │
│  (compact job list)  │  (recent 5, summary) │
├──────────────────────┼──────────────────────┤
│  User & Team         │  AI Costs            │
│  Governance          │  (always visible)    │
└──────────────────────┴──────────────────────┘
```

Module rules:
1. **All 4 modules `defaultOpen`** — admin visibility trumps collapsing.
2. **Scheduler Status = compact job rows** (name, status badge, human-readable cadence, Run Now, edit-icon → modal). Last-run / next-run / cron belong in tooltip or edit modal — not the primary view.
3. **Sync Runs = 5 most recent** in a compact table; "View All" link for full history. Never paginate in the summary.
4. **AI Costs = always visible**, never collapsed (compliance surface). Empty state shows "$0.00 this billing period".
5. **User & Team Governance = always open** — list + invite form immediately visible.

Scheduler cadences are editable inline via a human-friendly interval picker ("Every [N] [minutes/hours]") that writes to `policy_registry` / `policy_versions`. Min 5 minutes, max 168 hours. Save confirms: "Change [Job Name] schedule from [old] to [new]?"

---

## Forms, Errors, Empty States

- **Inputs and selects share one style** (see Component Inventory). Label above at `text-xs font-medium text-gray-600`, with `mt-1` to the input.
- **Error banner** (at top of form or page) uses the Error Banner component. Field-level errors use `text-xs text-red-700 mt-1` under the input. Never rely on red border alone.
- **Empty states** always include a second muted line with a next-step suggestion (e.g. "No items found." + "Try adjusting filters or import a CSV.").
- **Loading** uses the centered spinner on full-page loads; in-card loading uses a single-line `text-sm text-gray-500` with an inline spinner.

---

## Iconography & Imagery

- **Icon size**: `h-4 w-4` in buttons/chips; `h-5 w-5` in empty-state illustrations; `h-4 w-4 text-gray-400 hover:text-cbl-blue` for inline edit/chevron icons.
- **No decorative imagery** on dashboard pages — this is an internal tool. Marketing/public pages (outside the contract) may use brand imagery.
- **Logo**: Dashboard root header shows `text-xs font-semibold uppercase tracking-widest text-cbl-light/70` brand label + `text-xl font-bold text-white` title; interior pages use breadcrumbs instead.

---

## Checklist for New Dashboard Pages

1. Page uses `flex min-h-screen flex-col bg-white`.
2. Header uses `bg-cbl-navy shadow-md`; breadcrumbs at `text-base font-medium`.
3. Content area uses `max-w-6xl mx-auto w-full flex-1 px-6 py-6` (or `w-full px-6` for admin).
4. Footer uses `bg-cbl-dark` with `text-cbl-light/60`.
5. No arbitrary pixel font sizes; no `slate-*`, `emerald-*`, or `cyan-*` in dashboard pages.
6. Cards `rounded-xl border-gray-200`; buttons `rounded-lg`.
7. Admin sections use `CollapsibleCard` with appropriate `defaultOpen`.
8. All text ≥ 12px (`text-xs`).
9. Poppins loaded via Google Fonts in `globals.css`.
