# CBL Aero Dashboard UI Standards

All dashboard pages must follow these standards for visual consistency. The landing/login page (`/`) is excluded as it has its own branded design.

## Brand Colors (from cbl.aero)

Custom brand colors are defined in `globals.css` as CSS variables and registered in Tailwind's `@theme inline` block:

| Token | Hex | Tailwind Class | Usage |
|---|---|---|---|
| Navy | `#1a174d` | `cbl-navy` | Header background, primary buttons, headings, primary links |
| Blue | `#1d87c8` | `cbl-blue` | Hover states, accent highlights, progress bars, focus rings |
| Dark | `#101218` | `cbl-dark` | Footer background |
| Light | `#F3F5F5` | `cbl-light` | Text on dark backgrounds (header/footer) |

**Font**: Poppins (loaded via Google Fonts in globals.css), falling back to Segoe UI, Aptos, sans-serif.

---

## Page Layout

Every dashboard page uses the same flex column structure:

```tsx
<div className="flex min-h-screen flex-col bg-white">
  <header>...</header>   {/* Sticky header */}
  <main>...</main>       {/* Flex-1 content */}
  <footer>...</footer>   {/* Bottom footer */}
</div>
```

### Background

- **Page background**: Always `bg-white`. No dark mode, no gray backgrounds on page-level containers.
- **Card backgrounds**: `bg-white` with `border border-gray-200 rounded-xl` for primary cards.
- **Muted sections**: `bg-gray-50` for stat cards, info panels, and form containers within cards.

### Container Width

- Most dashboard pages use `max-w-6xl mx-auto px-6` for consistent horizontal bounds.
- **Admin Console exception**: The admin page uses `w-full px-6` (no max-width) because the 2x2 grid with data-dense modules needs all available horizontal space. This avoids horizontal scrolling in tables and cramped form layouts.
- Never use `max-w-5xl`, `max-w-4xl`, or narrower widths on dashboard pages.

---

## Header

Every page has a sticky header with this structure:

```tsx
<header className="sticky top-0 z-10 bg-cbl-navy shadow-md">
  <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
    {/* Left: breadcrumbs + optional subtitle */}
    {/* Right: action buttons */}
  </div>
</header>
```

### Breadcrumbs

Breadcrumbs use **`text-base font-medium`** (16px) with light text on the navy background:

```tsx
<nav className="flex items-center gap-2 text-base font-medium">
  <Link href="/dashboard" className="text-cbl-light hover:text-white">Dashboard</Link>
  <span className="text-cbl-light/40">/</span>
  <Link href="/dashboard/admin" className="text-cbl-light hover:text-white">Admin</Link>
  <span className="text-cbl-light/40">/</span>
  <span className="text-white">Current Page</span>
</nav>
```

- Active/clickable crumbs: `text-cbl-light hover:text-white`
- Current page (last crumb): `text-white` (not a link)
- Separator: `<span className="text-cbl-light/40">/</span>`
- Header right side: **always Sign Out button only** — no page-specific controls in the header
- Sign Out button: `rounded-lg border border-white/30 text-white hover:bg-white/10`
- Page-specific controls (Saved Searches, client switcher, etc.) go in the content area below the header

### Header Brand (Dashboard root only)

The dashboard root page shows a small brand label instead of breadcrumbs:

```tsx
<p className="text-xs font-semibold uppercase tracking-widest text-cbl-light/70">CBL Aero</p>
<h1 className="mt-1 text-xl font-bold text-white">Operations Dashboard</h1>
```

---

## Footer

Every page ends with the same footer:

```tsx
<footer className="bg-cbl-dark">
  <div className="mx-auto max-w-6xl px-6 py-4">
    <p className="text-sm text-cbl-light/60">CBL Aero &middot; Enterprise Portal</p>
  </div>
</footer>
```

---

## Typography Scale

Only use Tailwind's standard text size classes. **Never use arbitrary pixel values** like `text-[10px]`, `text-[11px]`, `text-[9px]`.

| Use Case | Class | Size |
|---|---|---|
| Page title | `text-xl font-bold` | 20px |
| Breadcrumbs / nav links | `text-base font-medium` | 16px |
| Section headers | `text-xs font-semibold uppercase tracking-wide` | 12px |
| Body text, form labels, table cells | `text-sm` | 14px |
| Auxiliary labels, timestamps | `text-xs` | 12px |
| Stat values (large) | `text-xl font-bold` | 20px |
| Button text | `text-sm font-medium` | 14px |
| Small button text | `text-xs font-medium` | 12px |

### Section Headers

All section headers follow this pattern:

```tsx
<h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Section Title</h2>
```

Or with a border:

```tsx
<h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-gray-400 border-b border-gray-100 pb-2">
  Section Title
</h2>
```

---

## Color Palette

### Primary Accent

- **CBL Navy/Blue** is the primary accent throughout the dashboard (matching cbl.aero branding).
- Links: `text-cbl-blue hover:text-cbl-blue/80` (in content) or `text-cbl-light hover:text-white` (in header)
- Primary buttons: `bg-cbl-navy text-white hover:bg-cbl-blue`
- Accent borders: `border-cbl-blue/30`, `border-cbl-blue/40`
- Accent backgrounds: `bg-cbl-blue/10`

### Text Colors

| Use | Class |
|---|---|
| Primary text | `text-gray-900` |
| Secondary text | `text-gray-700` |
| Muted text | `text-gray-500` |
| Placeholder/auxiliary | `text-gray-400` |

### Status Colors

| Status | Badge Class |
|---|---|
| Success/Active | `bg-green-100 text-green-700` |
| Warning/Passive | `bg-yellow-100 text-yellow-700` |
| Error/Unavailable | `bg-red-100 text-red-700` |
| Info | `bg-blue-100 text-blue-700` |
| Neutral | `bg-gray-100 text-gray-500` |

### Color Namespace

- Use `gray-*` for all neutral colors. **Never use `slate-*`** in dashboard pages.
- Use `cbl-navy`, `cbl-blue`, `cbl-dark`, `cbl-light` for brand accent. **Never use `emerald-*`** or **`cyan-*`** in dashboard pages.
- Use `rose-*` or `red-*` for errors. Prefer `red-*` for consistency.

---

## Cards and Sections

### Primary Card

```tsx
<section className="rounded-xl border border-gray-200 bg-white p-5">
  {/* Content */}
</section>
```

### Stat Card

```tsx
<article className="rounded-xl border border-gray-200 bg-gray-50 p-5">
  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Label</p>
  <p className="mt-2 text-sm font-medium text-gray-900">Value</p>
</article>
```

### Collapsible Card

Used on admin pages with multiple sections to reduce visual clutter. Each section has a clickable header with a chevron indicator that toggles content visibility.

```tsx
<CollapsibleCard title="Section Title" defaultOpen>
  {/* Content */}
</CollapsibleCard>
```

Implementation: `src/app/dashboard/admin/CollapsibleCard.tsx`

- Header: full-width clickable button with section title (same `text-xs font-semibold uppercase tracking-wide text-gray-400` as standard section headers) and a chevron icon (`h-4 w-4 text-gray-400`)
- Chevron rotates 180 degrees on open (via `transition-transform duration-200`)
- `defaultOpen` prop controls initial state; default is collapsed
- Card chrome: same `rounded-xl border border-gray-200 bg-white` as Primary Card
- Content padding: `px-5 pb-5` when open (header has its own `px-5 py-4`)

Child components inside a `CollapsibleCard` should **not** render their own section `<h3>` header — the card title replaces it.

### Info/Alert Banner

```tsx
<div className="rounded-xl border border-cbl-blue/30 bg-cbl-blue/10 p-5 text-sm text-cbl-navy">
  Banner content
</div>
```

### Error Banner

```tsx
<div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
  Error content
</div>
```

---

## Border Radius

- **Cards and sections**: `rounded-xl` (12px)
- **Buttons**: `rounded-lg` (8px)
- **Badges/pills**: `rounded-full`
- **Inputs**: `rounded-lg` (8px)
- **Modals**: `rounded-xl` (12px)

**Never use** `rounded-3xl`, `rounded-2xl`, or `rounded-md` on dashboard cards.

---

## Buttons

### Primary Button

```tsx
<button className="rounded-lg bg-cbl-navy px-4 py-2 text-sm font-medium text-white hover:bg-cbl-blue disabled:opacity-50">
  Action
</button>
```

### Secondary Button

```tsx
<button className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">
  Action
</button>
```

### Small Button

```tsx
<button className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
  Small Action
</button>
```

---

## Forms

### Input Fields

```tsx
<input className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-cbl-blue focus:outline-none focus:ring-1 focus:ring-cbl-blue" />
```

### Select Fields

Same styling as inputs:

```tsx
<select className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-cbl-blue focus:outline-none focus:ring-1 focus:ring-cbl-blue">
```

### Form Labels

```tsx
<span className="text-xs font-medium text-gray-600">Label</span>
```

---

## Tables

```tsx
<table className="w-full text-left">
  <thead>
    <tr className="border-b border-gray-100 bg-gray-50/50">
      <th className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-500">Header</th>
    </tr>
  </thead>
  <tbody className="divide-y divide-gray-100">
    <tr className="text-sm text-gray-700 transition-colors hover:bg-cbl-blue/5">
      <td className="px-5 py-2.5">Cell</td>
    </tr>
  </tbody>
</table>
```

---

## Loading States

```tsx
<div className="flex min-h-screen items-center justify-center bg-white">
  <div className="text-center">
    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-cbl-navy border-t-transparent" />
    <p className="mt-3 text-sm text-gray-500">Loading...</p>
  </div>
</div>
```

---

## Empty States

```tsx
<div className="rounded-xl border border-gray-200 bg-gray-50 py-16 text-center">
  <p className="text-sm text-gray-500">No items found.</p>
  <p className="mt-1 text-sm text-gray-400">Helpful suggestion here.</p>
</div>
```

---

## Spacing

- **Header padding**: `px-6 py-4`
- **Card padding**: `p-5`
- **Section gaps**: `mt-4` between major sections, `mt-6` for top-level spacing
- **Grid gaps**: `gap-4` standard, `gap-3` compact

---

## Admin Console Layout

The Admin Console (`/dashboard/admin`) contains 4 modules arranged in a **2x2 grid on desktop** (stacks vertically on mobile). No single module should dominate the viewport.

### Grid Layout

```
┌──────────────────────┬──────────────────────┐
│  Scheduler Status    │  Sync Runs           │
│  (compact job list)  │  (recent 5, summary) │
├──────────────────────┼──────────────────────┤
│  User & Team         │  AI Costs            │
│  Governance          │  (always visible)    │
└──────────────────────┴──────────────────────┘
```

```tsx
<div className="mt-4 grid gap-4 lg:grid-cols-2">
  {/* Top-left: Scheduler Status */}
  {/* Top-right: Sync Runs */}
  {/* Bottom-left: User & Team Governance */}
  {/* Bottom-right: AI Costs */}
</div>
```

### Module Rules

1. **All 4 modules open by default.** Collapsible cards retain the toggle but `defaultOpen` is true for all modules. Admins need at-a-glance visibility — hidden sections get ignored.

2. **Scheduler Status — compact job list, not a wide table.**
   - Each job renders as a dense row: job name, status badge, schedule in human-readable form (e.g., "Every 4 hours"), and a "Run Now" button.
   - Do NOT show columns for last-run, next-run, cron expression in the primary view. Those details belong in a tooltip, expandable detail row, or the edit modal.
   - The schedule is **editable inline**: a small edit icon next to the schedule opens an edit modal (see "Editable Scheduler Cadences" below).

3. **Sync Runs — recent 5, not paginated.**
   - Show only the 5 most recent sync runs in a compact table (source, started, duration, ok, failed, total).
   - A "View All" link at the bottom expands to the full paginated table or navigates to a dedicated page.
   - Do NOT show a 200-row paginated table in the summary view.

4. **AI Costs — always visible, never collapsed.**
   - Even when empty, show a placeholder: "$0.00 this billing period" with a muted empty-state message.
   - Admin cost visibility is a compliance requirement — it must not be hidden behind a collapsed card.

5. **User & Team Governance — always open.**
   - User management is a core admin task. Show the user list and invite form immediately.
   - The "Assign Role" and "Update Teams" forms can be inline or in a modal triggered from the user row.

### Editable Scheduler Cadences

Admins can change job schedules directly from the dashboard without a code deploy.

**UI Pattern:**
- Each job row shows its schedule in human-readable form (e.g., "Every 4 hours").
- A small pencil/edit icon (`h-4 w-4 text-gray-400 hover:text-cbl-blue`) next to the schedule text opens an edit modal.
- The modal contains:
  - A **human-friendly interval picker**: "Every [N] [minutes / hours]" dropdowns for simple cadences.
  - The **raw cron expression** shown below in a read-only text field for power users (updates live as the picker changes).
  - A **Save** button that persists the new schedule.
  - A **Cancel** button.

**Persistence:**
- Schedule changes write to the `policy_registry` + `policy_versions` tables in the `cblaero_app` schema.
- Each job is identified by its `policyFamily` + `policyKey` (already wired in `registerIngestionJobs()`).
- Changes take effect on the next scheduler tick — no restart or redeploy required.
- The `policy_versions` table tracks effective dates, giving a full audit trail of schedule changes.

**Validation:**
- Minimum interval: 5 minutes (prevent accidental sub-minute polling).
- Maximum interval: 168 hours (1 week).
- The Save action must confirm: "Change [Job Name] schedule from [old] to [new]?"

**Implementation Note:** The `CandidateAvailabilityRefreshJob` already reads `interval_hours` from `policy_registry` at runtime (story 2-6). Generalize this pattern to all 7 jobs by reading the schedule from `policy_versions` at job registration time and on each scheduler tick.

---

## Checklist for New Pages

When creating a new dashboard page, verify:

1. Page uses `flex min-h-screen flex-col bg-white`
2. Header uses `bg-cbl-navy shadow-md` with breadcrumbs at `text-base font-medium`
3. Content area uses `max-w-6xl mx-auto w-full flex-1 px-6 py-6`
4. Footer uses `bg-cbl-dark` with `text-cbl-light/60`
5. No arbitrary pixel font sizes (`text-[Npx]`)
6. No `slate-*` colors (use `gray-*`)
7. No `emerald-*` or `cyan-*` colors (use `cbl-navy`, `cbl-blue`, `cbl-dark`, `cbl-light`)
8. Cards use `rounded-xl border-gray-200`
9. Buttons use `rounded-lg`
12. Admin sections use `CollapsibleCard` with appropriate `defaultOpen` state
10. All text is `text-xs` (12px) or larger
11. Poppins font loaded via Google Fonts import in globals.css
