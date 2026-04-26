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
├── ui/         primitive components: Button, Input, ChainPicker
├── routes/    full route renders: Onboarding, Locked
```

## Run

```bash
pnpm test:a11y
```
