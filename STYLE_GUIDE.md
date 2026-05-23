# XChain Wallet — Style Guide

Living doc. The rule it exists to enforce: **if you find yourself copying CSS or JSX between two routes, lift it.** When in doubt, prefer one of the shared primitives below over re-rolling from scratch.

## Page chrome (secondary toolbar)

Every routed screen has a secondary toolbar below the global AppHeader. It carries: a back chevron, a centered title (optionally with a route-action icon), and an optional trailing action slot.

**Use `<ScreenHeader />` from `@xchain-wallet/core/ui`.** Do not roll your own `.header` / `.back` / `.title` CSS.

```jsx
import { Screen, ScreenHeader, Icon } from '@xchain-wallet/core/ui';

const header = (
    <ScreenHeader
        onBack={onBack}
        title="Send"
        titleIcon={<Icon.SendIcon />}
        trailing={<button onClick={openScanner} aria-label="Scan QR"><Icon.CameraIcon /></button>}
    />
);

return <Screen variant={variant} header={header}>{...}</Screen>;
```

**Props**

| prop | meaning |
|---|---|
| `onBack` | when set, renders a back chevron; omit to render a leading spacer |
| `title` | centered title text |
| `titleIcon` | optional inline icon to the left of the title (accent-colored) |
| `trailing` | optional right-side slot for page-scoped actions (filter, scan, etc.) |

**Why the chevron alignment is non-obvious**: AppHeader pads the outer bar by `space-3`; Screen.header pads by `space-4`. `<ScreenHeader />` cancels that delta with a `margin-inline-start: calc(var(--xc-space-3) - var(--xc-space-4))` on the back button so the chevron's left edge lines up with the X-Chain logo above. Trailing slot mirrors on the right.

## Buttons

Use `<Button>` from `@xchain-wallet/core/ui` for anything button-shaped. Variants: `primary` (filled accent), `ghost` (transparent). Pass `loading` for spinner state.

For icon-only buttons inside layouts (e.g. an action overlaid in an input box), a plain `<button>` is fine — but make it transparent (no background, no border) so it reads as an icon affordance, not a tappable rectangle. The hover state should change icon color only, not paint a fill.

## Inputs

Use `<Input>` from `@xchain-wallet/core/ui` for everything single-line. Pass-through props (`type`, `inputMode`, `autoComplete`, `style`) all forward to the underlying `<input>`. Pass `label` / `hint` / `error` for the labeled-input pattern.

**Primary entry inputs** (the To / Amount fields on Send) get the "big field" treatment:

```jsx
style={{
    fontSize: 'var(--xc-text-lg)',
    padding: 'var(--xc-space-3) var(--xc-space-4)',
    minHeight: '48px',
}}
```

Don't use inline styles for normal inputs — keep the bump reserved for the few fields the user is most likely to interact with on a page.

## Icons

The icon set lives in `packages/core/src/ui/icons/`. Most action icons are lucide-react wrappers; the rest are hand-rolled inline SVGs. Same calling convention: `<Icon.SendIcon />`, `<Icon.BookIcon />`, etc.

**Concept → glyph mapping** (so the same affordance reads the same way everywhere):

| Concept | Icon | Lucide source |
|---|---|---|
| Send | `SendIcon` | `Send` (paper airplane) |
| Receive | `ReceiveIcon` | hand-rolled (down arrow into tray) |
| Scan a QR | `CameraIcon` | hand-rolled (camera body + lens) |
| Address book / contacts | `BookIcon` | `BookOpen` |
| Filter | `FilterIcon` | `Filter` (funnel) |
| Search | `SearchIcon` | hand-rolled |
| More / menu | `MoreIcon` | hand-rolled (horizontal dots) |
| Settings | `GearIcon` | hand-rolled |
| Lock / Unlock | `LockIcon` / `UnlockIcon` | hand-rolled |

**Adding a new icon**: import the lucide source at the top of `icons/index.jsx`, wrap it in a thin export that passes `LUCIDE_PROPS` (matches the wallet's 18×18 size + stroke). Don't pull the icon directly at call sites — keep the indirection so we can swap one glyph for another without touching every route.

## Spacing + typography tokens

Defined in `packages/core/src/ui/tokens.css`. Always use the token, never raw px values, so dark-mode / theme overrides apply uniformly.

| Token | Approx value | Use for |
|---|---|---|
| `--xc-space-1` | 4px | gap inside compact controls |
| `--xc-space-2` | 8px | gap between sibling controls |
| `--xc-space-3` | 12px | section padding, default field margin |
| `--xc-space-4` | 16px | input padding (big-field) |
| `--xc-space-6` | 32px | card outer padding |
| `--xc-text-xs` | 0.75rem | metadata, hint text |
| `--xc-text-sm` | 0.875rem | labels, default body |
| `--xc-text-md` | 1rem | body text |
| `--xc-text-lg` | 1.125rem | big-field input text, section titles |
| `--xc-text-xl` | 1.25rem | hero token name, page H1 |

## Colors

Same source: `tokens.css`. Highlights:

| Token | Meaning |
|---|---|
| `--xc-text` | primary text |
| `--xc-text-muted` | secondary / label text |
| `--xc-accent-primary` | brand action color (back chevrons, primary buttons, route-action icons) |
| `--xc-surface` / `--xc-surface-raised` | card backgrounds |
| `--xc-bg-muted` | hover backgrounds |
| `--xc-border` / `--xc-border-strong` | hairlines |
| `--xc-danger` / `--xc-warning` | error / warning states |

Never hard-code hex. Use `color-mix(in srgb, var(--xc-accent-primary) 70%, white 30%)` for hover tints — that pattern is in the existing `.back:hover` rule and survives theme swaps.

## When you can't reach for a primitive

If you genuinely need a one-off layout that doesn't fit any existing pattern, **inline the style** rather than adding a new class to a route's CSS module. CSS modules with copy-pasted rules are the failure mode this guide exists to prevent. If you find yourself inlining the same thing twice, lift it into a shared component instead.

## Migration status

- [x] `<ScreenHeader />` exists and is exported from `@xchain-wallet/core/ui`.
- [ ] All existing routes use `<ScreenHeader />`. Migration tracked in TODO.md.

When you touch a route that still rolls its own header, please convert it. That's how the codebase converges over time without anyone having to do a big-bang refactor.
