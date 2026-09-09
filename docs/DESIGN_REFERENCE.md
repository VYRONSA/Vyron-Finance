# VYRON FINANCE — Design Reference

The visual specification for the Enterprise Design System, per the Product
Review Board's "Enterprise Design System Rollout" and "Dashboard as the
Master Template" instructions. The Dashboard
(`src/app/company/[companyId]/dashboard/page.tsx`) is the reference
implementation of everything below — when in doubt, read that file.

**Read this before building any new page or component.** Nothing here is
optional per-page styling; the whole point of the rollout was to stop
inventing new visual language per screen.

## Typography

Three roles, unchanged since the original marketing-artifact system —
Part 1/2's redesign was about color and surfaces, not type:

| Role | Font | CSS token | Used for |
|---|---|---|---|
| Display | Source Serif 4 | `font-display` | `h1`–`h4`, hero headlines |
| Body / UI | Inter | `font-sans` (default) | everything else |
| Financial figures | IBM Plex Mono | `font-mono` | any number that lines up in a column — money, percentages, counts. Always paired with `tabular-nums`. |

Scale in practice (see Dashboard for exact usage): hero headline
`text-3xl sm:text-4xl`, hero headline figure `text-5xl sm:text-6xl`
(mono), card title `text-base font-semibold`, KPI value `text-2xl`
(mono), body `text-sm`, eyebrow/label `text-xs uppercase tracking-wide`.

## Spacing scale

Section-level gaps: `gap-10` between major page blocks (hero → statistics
→ workspace → quick actions → footer). Card-internal: `p-10` for hero
cards, `p-5`/`p-6` for standard cards, `p-4` for compact tiles. Grid gaps:
`gap-4` for KPI/checklist grids, `gap-6` for two-column card grids, `gap-3`
for tight quick-action grids. Don't invent a new spacing value — reuse one
of these.

## Colour tokens

Defined in `src/app/globals.css`, layered into Tailwind via `@theme
inline`. One fixed identity (no light/dark toggle) — dark framing and
white paper surfaces coexist on every screen.

| Token | Hex | Use |
|---|---|---|
| `vf-canvas` | `#0b0909` | page background, main dark framing |
| `vf-canvas-raised` | `#141010` | sidebar, footer, slightly lifted dark surface |
| `vf-charcoal` / `vf-charcoal-soft` | `#1c1717` / `#251e1e` | Level 2 dark stat cards |
| `vf-red-900` → `vf-red-300` | `#4c0714` → `#ef5266` | executive red family — gradients use 500→700/900, accents use 400, tinted backgrounds use 500 at low opacity |
| `vf-paper` / `vf-paper-alt` | `#fdfbf9` / `#f4f1ed` | Level 3 white cards; `-alt` for table header rows / hover states |
| `vf-paper-border` | `#e6e1da` | borders and dividers on white surfaces only |
| `vf-ink` / `vf-ink-soft` / `vf-ink-faint` | dark greys | text **on paper only** |
| `vf-on-dark` / `vf-on-dark-soft` / `vf-on-dark-faint` | light greys | text **on canvas/charcoal/hero only** |
| `vf-dark-border` / `vf-dark-border-soft` | translucent white | borders on dark surfaces only |
| `vf-success` / `vf-warning` / `vf-danger` / `vf-info` / `vf-purple` / `vf-orange` | semantic | status badges, report charts |

**Rule**: never pair `vf-ink*` text with a dark background, or `vf-on-dark*`
text with a paper background — this was the exact bug class caught during
the rollout's live verification (an "active tab" button and several table
borders referencing the wrong surface's tokens). Check which surface a
component sits on before picking its text color token.

## Card hierarchy

`Card` (`src/components/ui/card.tsx`), `tone` prop:

- **`hero`** — Level 1. Deep red gradient (`from-vf-red-700 to-vf-red-900`),
  `shadow-vf-red-glow`. One per page, first thing after the header. Large
  padding (`p-10`).
- **`dark`** — Level 2. Charcoal, `shadow-vf-dark-card`. Statistic/KPI
  tiles and the recovery checklist.
- **`paper`** (default) — Level 3. White, `shadow-vf-paper-lg`. Every
  table, form, report, and list. This is where accountants read and edit.

## Table standard

`src/components/ui/table.tsx` — `Table`, `TableHead` (pass `sticky` for
long tables), `TableBody`, `TableRow`, `TableHeadCell`, `TableCell`. White
background, `py-3` row height, row hover (`hover:bg-vf-paper-alt/70`),
`divide-y` subtle separators, no heavy outer border beyond the containing
card. Used on Dashboard (Recent Journal Entries), Platform Workspace (My
Companies), and every Supplier Reconciliation report. **Every new table
must use these primitives** — no bespoke `<table>` markup.

## Form standard

`src/components/ui/input.tsx` (`Input`, `Select`) and `field.tsx`
(`Field` — label + control + error message) are the shared primitives,
extracted once Bank Accounts genuinely needed a second form (Create/Edit
Bank Account, `src/components/financial/bank-account-form.tsx`). White
`Card`, `rounded-lg` inputs with `border-vf-paper-border bg-vf-paper`,
`focus:border-vf-red-500`, primary action in `Button variant="primary"`,
secondary in `variant="subtle"` — matching Part 8 exactly. Auth's own
login/forgot-password inputs still predate these primitives and haven't
been retrofitted (no functional reason to touch working code — retrofit
opportunistically if either file is edited for another reason).

## Button variants

`src/components/ui/button.tsx` — pick by **which surface the button sits
on**, not by importance:

| Variant | Surface | Look |
|---|---|---|
| `primary` | any | red gradient — the one signature action colour |
| `outline` | dark canvas / charcoal | translucent border, on-dark text |
| `ghostDark` | hero / red gradient | translucent white border — the only variant that reads correctly on top of `primary`'s own red |
| `subtle` | paper card | neutral border, ink text |

## Icon usage

`src/components/ui/icons.tsx` — one hand-authored stroke set, 24×24
viewBox, `currentColor`, `strokeWidth={1.7}`, round caps/joins. Every KPI,
quick action, and nav icon draws from this file. Add a new icon only when
a real page needs it (each one currently used is referenced from
Dashboard's `KPI_ICONS` or `QUICK_ACTIONS`) — don't pre-build icons for
modules that don't exist yet.

## Page rhythm

Header (workspace shell) → Executive Hero (`tone="hero"`) → Statistics
(`KpiCard` grid, `tone="dark"`) → Primary Workspace (`tone="paper"` table/
list) → Secondary Workspace (`tone="paper"`) → Quick Actions
(`QuickActionCard` grid) → Footer Status (one muted text line). Applied
"approximately" — not every page needs every section, but the order never
inverts, and nothing paper-toned appears before the hero.

## Component index

| Component | File | Purpose |
|---|---|---|
| `Button` | `ui/button.tsx` | all actions |
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent` | `ui/card.tsx` | the 3-tier hierarchy |
| `Badge` | `ui/badge.tsx` | status pills (good/warn/info/danger/muted) |
| `KpiCard` | `ui/kpi-card.tsx` | standardised statistic tile with icon + trend |
| `Table` family | `ui/table.tsx` | the one table pattern |
| `Input`, `Select` | `ui/input.tsx` | the one form-control style |
| `Field` | `ui/field.tsx` | label + control + error wrapper |
| `EmptyState` | `ui/empty-state.tsx` | guide-forward "nothing here yet" pattern |
| `Skeleton` | `ui/skeleton.tsx` | loading placeholder block |
| `AnimatedNumber` | `ui/animated-number.tsx` | count-up on mount, respects reduced motion |
| `TrendChart` | `ui/charts/trend-chart.tsx` | single-series magnitude-over-time, area + line, crosshair tooltip |
| `ActivityBarChart` | `ui/charts/bar-chart.tsx` | single-series magnitude by category, per-bar tooltip |
| `StackedStatusBar` | `ui/charts/stacked-status-bar.tsx` | part-to-whole across reserved status colors (good/warn/danger) |
| `RadialMeter` | `ui/charts/radial-meter.tsx` | a single ratio against a limit, same-ramp track |
| `Section`, `Container`, `Eyebrow` | `ui/section.tsx` | marketing-site layout wrappers |
| `StatTile` | `ui/stat-tile.tsx` | bare value+label figure (no card of its own — nest inside a `Card`) |
| `QuickActionCard` | `financial/quick-action-card.tsx` | module shortcut — only ever built with a real `href`; no disabled/"Soon" state is used anywhere in the app |
| `RefreshButton` | `financial/refresh-button.tsx` | real loading-state re-fetch |

## Chart standard

Hand-authored SVG, no charting library — each chart's form is picked by
the job the data does (magnitude-over-time → line/area, magnitude-by-
category → bar, part-to-whole across a few named states → horizontal
stacked bar, single ratio → radial meter), never picked for decoration.
Sequential/single-series marks use the brand accent (`vf-red-400` — not
the raw `vf-danger` token, which falls below 3:1 contrast on a dark
charcoal card); part-to-whole status marks reuse the same reserved
success/warning/danger hues as `Badge`, never an arbitrary categorical
palette. Every mark has a hover **and** keyboard-focus tooltip — never
hover-only. No `Modal` component exists yet — nothing built today needs
one. Add real components against real usage when a module needs them, not
speculatively ahead of need.
