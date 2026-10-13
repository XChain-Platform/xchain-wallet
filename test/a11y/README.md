# A11y tests (runtime layer)

Runtime axe-core scans against rendered React surfaces. Complements
the **static** a11y audit at `packages/core/scripts/a11y-audit.js`
(button-needs-label, img-needs-alt, etc., enforced at the source level).

The runtime layer catches things static analysis can't:
- DOM-shape violations only visible after render (focus order, name
  computation, accessible-name conflicts)
- Implicit role checks driven by rendered ancestry
- Programmatic state attributes (`aria-busy`, `aria-expanded`,
  `aria-selected`) that match the rendered state

Color-contrast still requires a real browser (jsdom doesn't compute
styles); that lives in Playwright at `test/e2e/`.

## Layout

```
test/a11y/
├── helpers/    shared axe assertions
├── ui/         primitive components
└── routes/     full route renders and the route coverage inventory
```

The route inventory treats every JSX module discovered by the shared route
render registry as either axe-rendered or explicitly missing. This makes a new
route fail the accessibility suite until its coverage status is recorded.

The runtime route suite renders every M-Z route, plus History's ActionDetail,
Settings and its drilldown sections, the token issue, dispenser, order, bet, and poll voting forms, and Onboarding's license, explainer, and
welcome steps. `coverage.a11y.test.js` contains the complete, machine-checked
list of route modules that remain unrendered by axe.

## Run

```bash
pnpm test:a11y
```
