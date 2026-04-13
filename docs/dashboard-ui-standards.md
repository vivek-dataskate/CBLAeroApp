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

- All content uses `max-w-6xl mx-auto px-6` for consistent horizontal bounds.
- Never use `max-w-5xl`, `max-w-4xl`, `max-w-7xl`, or other widths on dashboard pages.

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
10. All text is `text-xs` (12px) or larger
11. Poppins font loaded via Google Fonts import in globals.css
