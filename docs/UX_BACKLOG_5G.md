# Phase 5G — UX backlog

Local only. No commit, no deploy, no migration applied, no production change.
Organisation and navigation work: no redesign, no colour/branding/typography
change, no new component library, no routes changed, no permissions changed.

## 1. Back control

`src/components/ui/back-link.tsx` — the one Back control. It is a REAL link to
the parent page first and a history step second, and that ordering is the design:

- a bare `router.back()` does nothing useful with no history (opened in a new
  tab, a pasted URL, the first page of a session, arrival from an external
  link), and can leave the app entirely;
- a real `href` works without JavaScript, can be middle-clicked, is focusable
  and announced as a link, and always has a correct destination.

The click upgrades to `router.back()` only when `shouldUseHistoryBack` says the
previous page was same-origin AND inside the same company — so a cross-company
referrer, an external referrer, an empty referrer or a malformed one all fall
back to the explicit destination. That is what keeps tenant context intact.
Going back is preferred when it IS safe because it restores the previous page's
own state (its tab, filters, scroll and search), which navigating to the parent
href would discard — so query-string tabs and report filters survive.

### Route inventory (55 pages)

| Page | Already had back | 5G | Reason |
|---|---|---|---|
| 39 top-level nav destinations (`dashboard`, `banking-rules`, `transactions`, `reporting`, `settings`, …) | — | **Excluded** | These ARE the sidebar's destinations. A Back button on a page you reach from the nav duplicates the nav and has no single correct parent. |
| `suppliers/[supplierId]` | No | **Added** → `suppliers` | Detail page, no way up |
| `customers/[customerId]` | No | **Added** → `customers` | Detail page, no way up |
| `bank-accounts/[accountId]` | No | **Added** → `bank-accounts` | Detail page, no way up |
| `xero-import` | No | **Added** → `import-centre` | Orphan route, not in the nav at all |
| `reporting/[category]` | Yes — breadcrumb to Reporting Centre | Excluded | Already has an appropriate control |
| `general-ledger/[accountId]` | Yes — "Back to Trial Balance" | Excluded | Already has one, and it targets the right tab |
| `reporting/print/[reportId]`, `reporting/documents/[docType]/[docId]` | Yes — overlay Close → `backHref` | Excluded | Full-screen overlays with their own dismiss + Escape |
| `bank-accounts/new`, `bank-accounts/[accountId]/edit` | Yes — form Cancel | Excluded | A form's Cancel is the right control; a second one would compete |
| `documents/invoice/[invoiceId]/pdf-view`, `documents/statement/[customerId]/pdf-view` | `onClose` is a no-op | **Excluded — deliberate** | These are NOT user-navigable. They are headless-browser capture surfaces for `pdf-generation-service.ts`; a Back control would be rendered into the generated PDF. |
| `platform/new-company` | Yes — wizard Cancel/Back | Excluded | Wizard-scoped control already correct |
| `/login`, `/forgot-password`, `/reset-password`, `/pricing`, `/`, `/setup` | Mixed | Excluded | Auth/marketing flows with their own navigation |

## 2. Banking Rules search

A search box and the pure, unit-tested `ruleMatchesSearch` ALREADY existed
(Phase 51). 5G extended it rather than adding a second search: it now also
matches rule type, domain, condition field and operator, action type, priority,
and the status words shown on the row ("enabled"/"disabled"). Underscores match
both ways, because `set_gl_account` is an implementation detail nobody types.
GL account and VAT code were already covered — both live in an action's
`targetText`.

Also added: a Clear button (the requirement asked for "clearable"; there was no
way to clear in one action), and a count line — "4 rules" / "1 of 4 rules" — so
a filtered list never looks like the whole list. Search is client-side over
server-rendered props: no reload, no new endpoint, case-insensitive, and it
composes with the existing domain and status filters.

## 3. Banking Rules list

Before: every rule rendered a complete, permanently-open inline editor. With
100+ rules that is 100+ open forms — you could not see what rules existed, scan
for one, or reach it without scrolling past everything above it. That is the
"scattered cards" the requirement describes.

Now: one scrollable table, every rule a row, with the columns asked for — Rule
(name + description), Status, Priority, Type, Condition, GL Account, VAT,
Action. Built from the existing design system (`Table`, `Badge`, `EmptyState`),
matching `banking-rules-analytics-tab.tsx`'s table in the same folder. The
table scrolls internally, so the page itself never scrolls horizontally
(measured: 0px document overflow at all four viewports).

## 4. Rule detail / edit

Opening a row renders **the existing `RuleCard`** underneath it — the same
component, same props, same save/delete/version-history, same `previewMode`
gating, same API routes and permission keys. No second editor was built. One
rule is open at a time, so the screen never returns to a wall of open forms.
The row control is a real `<button>` with `aria-expanded`/`aria-controls`, so
the list is keyboard operable.

## 5-7. Sidebar grouping, responsiveness and state

`NAV_GROUPS` and its helpers moved verbatim into `workspace-nav.ts`, and
`workspace-nav-sections.tsx` renders them. The desktop sidebar and the
tablet/mobile drawer both render THAT component, from the same model and the
same open-section state — one navigation system in two places, as required.

Grouping: 44 flat links became 4 collapsible sections (Executive, Reporting,
Automation, Workspace). No route, label, icon or ordering changed.

State (the simplest predictable rule): the open section is **derived**, not
stored. `activeNavGroup(pathname)` decides it, and a click overrides that until
the route moves to a different section. Because the override records which
section was active when it was made, arriving in a new section always reveals
where you now are, while moving between two pages of one section never fights a
user who collapsed it. One value, so only one section can be open — that is
structural, not a rule to remember. Deriving it also avoids a setState-in-effect,
which the React Compiler correctly flags as a cascading render.

Responsive: below `lg` the sidebar is `hidden` and there was NO control of any
kind to reach navigation — the 768×1024 gap. A menu button now sits in the
header (`lg:hidden`), opening a drawer with `role="dialog"`/`aria-modal`. It
closes on link click, on its own close button, on the backdrop, and on Escape;
Escape returns focus to the menu button, and opening it moves focus into the
drawer. The desktop sidebar is unchanged (`hidden … lg:flex`).

Icons-only focus mode (Transaction Explorer) deliberately keeps the flat icon
strip: there is no room for section headings at 72px, and putting navigation
behind two clicks there would be worse, not better.

## 8. Verification

Browser (local preview-mode app, Edge via puppeteer-core), **56/56 checks
passed** at 1440×900, 1024×768, 768×1024 and 390×844: sidebar present only at
≥1024, menu button present only below it, navigation reachable at every width,
four grouped sections, exactly one expanded, drawer opens and closes on Escape,
Banking Rules search present/filtering/clearable/restoring, list rendering,
opening a rule opening the existing editor, Back control on supplier detail,
and 0px horizontal document overflow everywhere.

Tests: 104 in the directly affected suites; full suite 4655 passed / 0 failed.
Typecheck clean, lint 0 errors, `next build` exit 0.

### Tests deliberately updated (not weakened)

Two pre-existing assumptions were tied to "every rule is an open editor" and
had to change with the UX:

- rules were located with `getByDisplayValue(rule.name)` — that only worked
  because each rule mounted an editable `<Input>`. They now match on the
  visible row text.
- one Test + one Simulate button PER RULE was asserted. Those belong to the
  editor, which now opens on demand; the test asserts none are present until a
  rule is opened, then exactly one of each.

The capability is unchanged; what changed is that it no longer costs 100+ open
forms to have it.

### A real defect found and fixed during the work

The existing `axe` test caught an empty `<th>` in the new table
(`empty-table-header`), which would have left screen-reader users without a
name for the checkbox column. Fixed with an `sr-only` label rather than by
relaxing the test.
