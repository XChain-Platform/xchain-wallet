# XChain Wallet Style Guide

Living doc. The rule it exists to enforce: **if you find yourself copying CSS or JSX between two routes, lift it.** When in doubt, prefer one of the shared primitives below over re-rolling from scratch.

The live catalog is the style guide page, served by the web dev server at `/style-guide/`. Its bar switches ordinary examples between Mobile (360px), Extension popup (400px) and Desktop (1024px) frames, and `?view=mobile|extension|desktop` in the URL opens a given view. Page-template examples instead show compact (360px), rail (768px), and full (1024px) widths together so the page gutter is visible at every layout tier.

## Page templates

**Every routed screen should be built from exactly one page template.** A screen is a `<Screen>` with a `<PageHeader>`, and its body is one `<FormPage>` or one `<ListPage>`. All of them come from `@xchain-wallet/core/ui`. The migration checklist at the end tracks routes that do not meet this rule yet.

```jsx
import { Screen, PageHeader, FormPage, FormSection, ListPage, EmptyState, SectionHeader } from '@xchain-wallet/core/ui';
```

| template | use it when the screen... | examples |
|---|---|---|
| `<FormPage>` | is a form the user fills in and submits | Send, rename, every action form, sign / verify |
| `<FormPage sectioned>` + `<FormSection>` | is a long form whose fields fall into named groups | Issue token, Create dispenser, Create poll |
| `<ListPage>` | shows things: a list, table, card grid, or read-only detail rows | Payments due, contacts, my tokens, polls, a dispenser's detail |

Two parts go inside them: `<EmptyState>` is the one empty state (a list that loaded with nothing in it), and `<SectionHeader>` titles a group of content (it is also FormSection's heading). A detail screen with an Edit button is a ListPage; the edit screen it opens is a FormPage.

### The single page gutter

`Screen.body` owns the only page inset. It applies `padding-inline: var(--xc-page-gutter)` and `padding-block-start: var(--xc-page-top)`. The responsive values are:

| layout | `--xc-page-gutter` | `--xc-page-top` |
|---|---:|---:|
| compact, below 640px | 12px | 12px |
| rail, 640px to 899px | 16px | 16px |
| full, 900px and up | 24px | 16px |
| short landscape, at any width | unchanged for its width | 8px |

Page templates and route content do not add another outer horizontal inset. `ListPage` stretches across the complete content box. `FormPage` is bare below 600px and becomes one centered 560px card at 600px and up. The global `AppHeader`, `Screen.header`, and `Screen.footer` are chrome, not page content, so they keep their own padding and do not consume either page token.

### The form rule: narrow is bare, wide is one card

One rule on every platform (phone, extension popup, desktop app, browser), decided by **viewport width with a CSS media query at 600px**:

- **Narrow, under 600px** (a phone, the 360 to 400px extension popup, a narrow desktop window): the form's fields sit bare on the page with only the page gutter. No card border, background or padding.
- **Wide, 600px and up**: the form sits in one card, a centred column 560px wide.
- **Long forms** are split into `<FormSection>`s inside `<FormPage sectioned>`: bare sections divided by their heading when narrow, a stack of section cards when wide.
- **The action row** (`actions`) sits at the end of the form, after the last field or the last section card, and wraps. Each button grows to share the row, so a lone button is full width; put the primary action last so it lands on the right. Errors go in `status`, just above the actions.

The breakpoint is a viewport media query, not a container query. Chrome 102, the oldest Android WebView engine we support, has no container queries. Do not choose the layout from the shell: a phone browser gets the narrow form and a wide desktop window gets the card. The sidebar nav appears at 640px, so 600 to 639px shows the bottom tab bar with a carded form; that is expected.

### Viewport width scale

Core CSS modules use this reviewed set of viewport widths. Choose the narrowest point that solves the layout problem instead of adding a nearby value.

| width | use |
|---|---|
| `360px` | the extension popup width: fallbacks at or below the popup |
| `400px` | extension-width detail layouts |
| `420px` | narrow row and toolbar stacking |
| `480px` | compact grids, dense controls and the header network badge |
| `600px` | the form and narrow route boundary |
| `640px` | rail layout and sidebar begin |
| `900px` | full layout and labelled sidebar begin |
| `48rem` | wide collectible grids |
| `1024px` | desktop reference frame and future desktop-only refinements |

The current CSS-module audit uses `360px`, `400px`, `420px`, `480px`, `600px`, `640px`, `900px`, and `48rem`. A below-breakpoint rule uses `not all and (min-width: N)` so the source names the real boundary without inventing `N - 1`. In particular, 600px remains on the wide side of the form rule. Values such as 359px, 399px, 599px, 601px, 639px, 899px, and 1023px are aliases, not additional breakpoints.

### The list rule: full width to the scrollbar

`<ListPage>` fills the Screen content box from `--xc-page-gutter` on the left to the page gutter and reserved scrollbar gutter on the right. Do not wrap it in a card or add a centered maximum width: lists, tables and card grids use all available content width at compact, rail, and full widths. The optional `toolbar` holds search, filter and sort; its first control takes the spare room and the rest wrap below it on a phone. Give a search box `type="search"` and an `aria-label`.

### Props

| component | props |
|---|---|
| `FormPage` | `onSubmit`, `actions`, `status`, `intro`, `sectioned`, `label` (accessible name), `noValidate` (default `true`), `className`, `ref` (the form), `children`, and other form attributes |
| `FormSection` | `title`, `description`, `headingLevel` (`h2` default), `className`, `children` |
| `ListPage` | `toolbar`, `intro`, `className`, `children`, and other root attributes such as `aria-label` |
| `EmptyState` | `title`, `body` (one line), `icon`, `actionLabel` + `onAction`, `actionIcon`, `titleAs` (`h2` default), `role` (`status` default), `className` |
| `SectionHeader` | `title`, `as` (`h2` default), `id`, `description`, `trailing`, `className` |

```jsx
// A form screen
<Screen variant={variant} header={<PageHeader onBack={onBack} title="Verify signature" />}>
    <FormPage
        label="Verify signature"
        onSubmit={handleSubmit}
        status={error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
        actions={<Button type="submit" variant="primary" loading={busy}>Verify signature</Button>}
    >
        <Input label="Address" ... />
    </FormPage>
</Screen>

// A list screen with an empty state and a titled group
<Screen variant={variant} header={<PageHeader onBack={onBack} title="Payments due" />}>
    <ListPage toolbar={<input type="search" aria-label="Search payments" ... />}>
        {rows.length === 0 ? <EmptyState title="No payments due" body="..." /> : <ul>...</ul>}
        <SectionHeader title="Expired, awaiting settlement" />
        <ul>...</ul>
    </ListPage>
</Screen>
```

## Page chrome (secondary toolbar)

Every routed screen has a secondary toolbar below the global AppHeader. It carries: a back chevron, a centered title (optionally with a route-action icon), and an optional trailing action slot.

**Use `<PageHeader />` from `@xchain-wallet/core/ui`.** Do not roll your own `.header` / `.back` / `.title` CSS.

```jsx
import { Screen, PageHeader, Icon } from '@xchain-wallet/core/ui';

const header = (
    <PageHeader
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
| `backLabel` | accessible label for the back button (`Back` default) |
| `title` | centered title text |
| `titleIcon` | optional inline icon to the left of the title (accent-colored) |
| `backDisabled` | disables the back button while a submit is in flight; the chevron stays visible but inert |
| `trailing` | optional right-side slot for page-scoped actions (filter, scan, etc.); buttons render as circular 38px controls |

**Why the chevron alignment is non-obvious**: AppHeader and Screen.header are chrome with their own padding; neither uses `--xc-page-gutter`. The back chevron glyph also sits about 10px inside its own 28px SVG (the `BackIcon` vertex is at 9/24 of the viewBox), so a box-aligned button still reads indented. `<PageHeader />` owns the optical correction through `--xc-page-header-chevron-nudge`. Its trailing slot mirrors the chrome alignment on the right, and its buttons render as circular 38px controls so their right edges line up with the AppHeader buttons.

## Buttons

Use `<Button>` from `@xchain-wallet/core/ui` for anything button-shaped. Variants: `primary` (the one action the screen exists for), `secondary` (a second real action), `ghost` (cancel, back out, less-used actions), `danger` (destroys or spends irreversibly), `success` (approve a pending request). Sizes: `md` (36px minimum height, default) and `sm` (28px minimum height). `block` makes it full width, `loading` shows a spinner and disables it, `disabled` disables it, and `type` defaults to `button` so it never submits by accident. `icon` accepts a node; omit it to select an icon from a static string label or pass `null` to suppress that automatic icon. Other native button attributes pass through. A variant name outside this list retains the base Button layout and size but has no variant color styling, so treat it as invalid. The style guide's Buttons section shows every supported combination.

For dialogs use the shared `NoticeModal` (one OK) from `@xchain-wallet/core/shared/components/NoticeModal.jsx` and `ConfirmModal` (Cancel / Confirm, `danger` for destructive confirms) from `@xchain-wallet/core/shared/components/ConfirmModal.jsx`, never `alert()` or `confirm()`.

For icon-only buttons inside layouts (e.g. an action overlaid in an input box), a plain `<button>` is fine, but make it transparent (no background, no border) so it reads as an icon affordance, not a tappable rectangle. The hover state should change icon color only, not paint a fill.

## Inputs

Use `<Input>` from `@xchain-wallet/core/ui` for everything single-line. Pass-through props (`type`, `inputMode`, `autoComplete`, `style`) all forward to the underlying `<input>`. Pass `label` / `hint` / `error` for the labeled-input pattern. Its `size` prop is `md` (36px minimum height, default) or `lg` (48px minimum height with a larger, weightier label). `Select`, `Textarea`, `AmountField`, and `AddressCombobox` use the same `md` / `lg` contract.

**Primary entry inputs** (the To / Amount fields on Send) use `size="lg"`:

```jsx
<Input label="Amount" size="lg" />
```

Use `md` for normal inputs. Do not duplicate the `lg` font, padding, or height with inline styles.

### Required and optional fields

Mark optional fields, not required fields. Required fields use their plain label, while every optional field ends with the exact suffix `(optional)`. Do not mix this with `(required)` markers, and keep units outside the marker: `Feed fee (%) (optional)`, not `Feed fee (optional, %)`.

`Input`, `Select`, and `Textarea` expose the matching requirement through `aria-required`. A plain string label is required by default. Use the `optional` prop when a field is optional, especially when its base label is translated or dynamic; the component appends the suffix and sets `aria-required="false"`. Existing literal labels ending in `(optional)` receive the same accessibility state. The native `required` prop remains available when browser constraint validation is appropriate.

```jsx
<Input label="Account name" />
<Input label={t('send.memo')} optional />
<Select label="Network" value={chainId}>…</Select>
```

## Amount field (with USD / coin swap)

Use `<AmountField>` from `@xchain-wallet/core/shared/components/AmountField.jsx` for a transferable coin or token amount. It composes the shared `Input`, live thousand-separator formatting, an optional inline Max button, the coin / fiat swap footer, and optional balance text. It defaults to `size="md"`; Send and other hero screens pass `size="lg"`.

The parent owns the values and conversion. `amount` is the canonical coin-scale string. In fiat mode, preserve the user's exact text in `fiatAmount` and derive `amount` with `fiatToCoin` on every keystroke. `onAmountFieldChange` receives the raw displayed value and cursor position. The reusable cursor helpers live in `packages/core/src/shared/utils/amountFormat.js`: `formatWithThousands`, `countNonCommaBefore`, and `indexAfterNonCommaCount`.

`fiatRate` enables the unit-swap footer, which shows the derived value in the other unit. Without a rate, the swap control is hidden. `balanceText` fills the footer's right side with context such as "X TICK available", "Loading…", or "Balance unavailable". Omit `onMax` when Max is not meaningful; use `maxDisabled` and `maxBusy` while it cannot run.

```jsx
import { AmountField } from '@xchain-wallet/core/shared/components/AmountField.jsx';

<AmountField
    size="lg"
    amount={amount}
    fiatAmount={fiatAmount}
    tick={tick}
    fiatRate={fiatRate}
    fiatCurrency={fiatCurrency}
    amountInputMode={amountInputMode}
    onAmountFieldChange={onAmountFieldChange}
    toggleAmountInputMode={toggleAmountInputMode}
    inputRef={amountInputRef}
    onMax={onMax}
    maxDisabled={!spendableBalance}
    maxBusy={maxBusy}
    balanceText={availableText}
/>
```

Do not round-trip the user's typed fiat string through the converter for display. That loses trailing zeros and disturbs the cursor.

## "To" field (recipient address)

Use `<AddressCombobox>` from `@xchain-wallet/core/ui`; it ships the autocomplete dropdown for contacts and recent recipients. It accepts the shared `size` prop and owns one optional trailing action through `icon`, `onIconClick`, and `iconLabel`. Use `icon="contacts"` for the address-book action or `icon="addresses"` for an own-address picker.

```jsx
<AddressCombobox
    size="lg"
    icon="contacts"
    iconLabel="Open address book"
    onIconClick={openAddressBook}
    label="To"
    value={toAddress}
    onChange={(e) => setToAddress(e.target.value)}
    onPaste={onAddressPaste}
    suggestions={suggestions}
    placeholder="Enter or paste an address or name…"
/>
```

**Rules:**
- Always pass `suggestions`; it's what makes the combobox useful. Source them from contacts + recent send history scoped to the active chain.
- Treat paste as a special event (`onPaste`) so you can run paste-time validation (chain match, novelty check) before the value lands in state.
- Let `AddressCombobox` reserve the right padding and position its icon action. Do not wrap it in another absolutely-positioned button.
- One inline action max (the most-used: typically Address Book). If you have multiple secondary actions (scan, paste-from-clipboard, etc.), move them to the toolbar's trailing slot or behind a `MoreIcon` overflow.

## Fee selector

Use `<FeeSelector>` from `@xchain-wallet/core/ui` whenever a screen exposes a fee priority. It's a 3- or 4-stop slider (Low / Normal / Fast / optional Custom) over a native `<input type="range">` styled with `accent-color: var(--xc-accent-primary)`.

```jsx
import { FeeSelector } from '@xchain-wallet/core/ui';
import { estimateNativeSendFeeTiers, fetchNativeSendFeeTiers } from '@xchain-wallet/core/flows/feeEstimate';

const [feeTiers, setFeeTiers] = useState(null);
const [feePick, setFeePick] = useState({ mode: 'normal' });

useEffect(() => {
    if (!chainId) return;
    setFeeTiers(estimateNativeSendFeeTiers({ chainId, chainRegistry }));
    fetchNativeSendFeeTiers({ messaging, chainId, chainRegistry })
        .then((tiers) => tiers && setFeeTiers(tiers));
}, [chainId, messaging]);

<FeeSelector
    label="Network fee"
    coinTicker={coinTicker}
    tiers={feeTiers}
    value={feePick}
    onChange={setFeePick}
    allowCustom={false}        // omit/true for Send; false for Receive
/>
```

**Props worth knowing:**

| prop | when to set |
|---|---|
| `tiers` | required; from `estimateNativeSendFeeTiers` (sync seed) and/or `fetchNativeSendFeeTiers` (live SDK upgrade). Null shows a placeholder. |
| `value` / `onChange` | `{ mode, customRate? }`; mode is `'low' \| 'normal' \| 'fast' \| 'custom'`. |
| `coinTicker` | native coin symbol (BTC / LTC / DOGE) shown after the fee amount so it's clear which coin the fee is paid in. |
| `allowCustom` | default `true`. Set `false` on receive-style flows where the receiver only expresses a tier preference (custom sat/vB ages out by the time the QR is scanned). |
| `label` | renders inside the FeeSelector wrap so the label-to-slider gap matches the slider's internal rhythm. Skip your own outer label/title. |
| `customEstimate` | optional `FeeEstimate` for Custom mode so the readout stays live while the user edits the rate. |

**Rules:**
- Always pull tiers via the helpers above; never compute fee rates inline. The async path upgrades the sync seed when live SDK data arrives.
- Receivers encoding a fee preference on a QR should always emit the picked tier (use the `feePriority` field on `xchainUri`). Senders scanning that URI seed `feePick.mode` from the prefill so the receiver's pick lands by default.
- If a chain has no oracle, FeeSelector renders its own placeholder ("Fee estimate unavailable for this chain."), so don't hide the section, leave it visible so the affordance is discoverable.

## Icons

The icon set lives in `packages/core/src/ui/icons/`. Most action icons are lucide-react wrappers; the rest are hand-rolled inline SVGs. Same calling convention: `<Icon.SendIcon />`, `<Icon.BookIcon />`, etc.

**Concept to glyph mapping** (so the same affordance reads the same way everywhere):

| Concept | Icon | Lucide source |
|---|---|---|
| Send | `SendIcon` | `Send` (paper airplane) |
| Receive | `ReceiveIcon` | `ArrowDownToLine` |
| Scan a QR | `CameraIcon` | hand-rolled (camera body + lens) |
| Address book / contacts | `BookIcon` | `BookOpen` |
| Filter | `FilterIcon` | `Filter` (funnel) |
| Search | `SearchIcon` | hand-rolled |
| More / menu | `MoreIcon` | `MoreHorizontal` |
| Settings | `GearIcon` | hand-rolled |
| Lock / Unlock | `LockIcon` / `UnlockIcon` | hand-rolled |

**Adding a new icon**: import the lucide source at the top of `icons/index.jsx`, wrap it in a thin export that passes `LUCIDE_PROPS`, and include `data-xc-icon`. Don't pull the icon directly at call sites; keep the indirection so we can swap one glyph for another without touching every route.

Shared icons are sized by the `svg[data-xc-icon]` rule in `tokens.css`. A component selects a named size by setting `--xc-icon-size`; the rule defaults to `--xc-icon-md`. Keep literal pixel fallbacks in SVG `width`, `height`, or Lucide `size` props. Never put `var()` in an SVG sizing attribute because Chrome 102 can render the icon at its 300px default instead.

## Design tokens

Defined in `packages/core/src/ui/tokens.css`. Use the token instead of repeating its raw value in component styles, so theme and accessibility overrides apply uniformly.

### Spacing and typography

| Token | Value | Use for |
|---|---|---|
| `--xc-space-1` | 4px | gap inside compact controls |
| `--xc-space-2` | 8px | gap between sibling controls |
| `--xc-space-3` | 12px | default field margin, compact card padding |
| `--xc-space-4` | 16px | large-input horizontal padding |
| `--xc-space-5` | 20px | loose cluster spacing |
| `--xc-space-6` | 24px | card outer padding |
| `--xc-space-8` | 32px | section breaks and page-level rhythm |
| `--xc-page-gutter` | 12px compact, 16px rail, 24px full | the sole inline page inset, applied by `Screen.body` |
| `--xc-page-top` | 12px compact, 16px rail/full, 8px short landscape | the sole page-content top inset, applied by `Screen.body` |
| `--xc-text-xs` | 0.6875rem | metadata, hint text |
| `--xc-text-sm` | 0.8125rem | labels, secondary body text |
| `--xc-text-md` | 0.875rem | default body text and button labels |
| `--xc-text-lg` | 1rem | large-input text, section titles, page title |
| `--xc-text-xl` | 1.25rem | asset hero name, panel headings |
| `--xc-text-2xl` | 1.5rem | hero figures and prominent asset tickers |

### Icon sizes, radii, shadows and stacking

| Token | Value |
|---|---|
| `--xc-icon-xs` | 14px |
| `--xc-icon-sm` | 16px |
| `--xc-icon-md` | 18px |
| `--xc-icon-lg` | 20px |
| `--xc-icon-xl` | 24px |
| `--xc-radius-sm` | 4px |
| `--xc-radius-md` | 8px |
| `--xc-radius-lg` | 12px |
| `--xc-radius-pill` | 9999px |
| `--xc-shadow-sm` | 0 1px 2px rgba(15, 23, 42, 0.06) |
| `--xc-shadow-md` | 0 4px 12px rgba(15, 23, 42, 0.08) |
| `--xc-z-base` | 1 |
| `--xc-z-sticky` | 20 |
| `--xc-z-dropdown` | 50 |
| `--xc-z-overlay` | 60 |
| `--xc-z-modal` | 1000 |
| `--xc-z-toast` | 9999 |

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
| `--xc-danger`, `--xc-danger-fg`, `--xc-danger-bg`, `--xc-danger-text`, `--xc-on-danger` | danger actions, glyphs, tinted panels, panel text and text on danger fills |
| `--xc-info`, `--xc-info-bg`, `--xc-info-text` | informational accents, tinted panels and panel text |
| `--xc-warning`, `--xc-warning-bg`, `--xc-warning-text` | warning accents, tinted panels and panel text |
| `--xc-success`, `--xc-success-fill`, `--xc-success-bg`, `--xc-on-success` | success glyphs, fills, tinted panels and text on success fills |

Do not hard-code interface colors in components. Use tokens, or `color-mix(in srgb, var(--xc-accent-primary) 70%, white 30%)` for a derived hover tint; that pattern is in the existing `.back:hover` rule and survives theme swaps. Token definitions, encoded image data, and data-driven semantic palettes are the places where literal color values belong.

## UI copy

Use sentence case for page titles, headings, buttons, menu items, field labels and status messages. Preserve the normal spelling of proper nouns, tickers and initialisms.

In user-facing copy, say **recovery phrase**, not seed phrase or mnemonic, and **network fee**, not transaction fee, miner fee or gas fee. Protocol-specific fees remain distinct from the network fee.

## Browser baseline

Chrome 102 is the oldest supported Android WebView engine. CSS and SVG must keep working there: use viewport media queries instead of container queries, guard newer viewport units with `@supports`, and never use `var()` in SVG sizing attributes.

## Asset selectors (tap to repick)

Use `<TokenField>` from `@xchain-wallet/core/shared/components/TokenField.jsx` for the normal in-form asset selector. It is a field-shaped button that displays the selected `{ chainId, tick }`, `TickerIcon`, chain name, and a trailing token-list icon. The entire field opens the host-owned `TokenPicker`. It accepts `label` (`Token` default), `size` (`md` default or `lg`), `value`, `onOpenPicker`, `placeholder`, `disabled`, `error`, and `id`.

```jsx
<TokenField
    label="Token"
    size="lg"
    value={{ chainId, tick }}
    onOpenPicker={openTokenPicker}
/>
```

`TokenField` resolves the token art, chain pip, and letter fallback through the shared `TickerIcon`, so routes should not duplicate that chain. Creating a new ticker remains a free-text `Input`; a token fixed by route context should use the read-only `LockedTokenContext` instead.

**Vertical asset hero**, used on Send, is the deliberate exception. A large icon is centered above a bold name, and only the icon is tappable. The name and surrounding whitespace stay inert. A hero element fills the row and would otherwise turn the entire top of the form into a navigation trap; scoping the hit target to the circular icon keeps the safe zone large.

```jsx
<div className={styles.heroWrap}>
    <button
        type="button"
        onClick={onChangeAsset}
        className={`${styles.heroIconWrap} ${styles.heroIconWrapInteractive}`}
        aria-label={`Change asset (currently ${heroName})`}
    >
        {/* large icon + optional chain overlay */}
    </button>
    <div className={styles.heroName}>{heroName}</div>
</div>
```

**Hero rules:**

- The icon image renders with `object-fit: contain` and **no `border-radius`** on the image itself, so the published art keeps its shape (round / square / odd). Any focus ring goes on the wrapper, not the image.
- Native assets use `branding.chainIconLargeUrl(descriptor.id)`. Non-native tokens use the token's `imageUrl`, with `branding.chainIconSmallUrl(descriptor.id)` overlaid bottom-right as a small "pip" so the chain is still visible.
- If no image is available, fall back to a colored letter chip tinted via `tickerColor(tick)` (exported from `BalanceList.jsx`).
- The host owns picker navigation and writes the selected `{ chainId, tick }` back into route state. Preserve the rest of the form state across that round trip.

If a route needs an asset selector, use `TokenField` or the existing Send hero rather than reimplementing icon resolution, the chain pip, and fallback behavior.

## When you can't reach for a primitive

If you genuinely need a one-off layout that doesn't fit any existing pattern, **inline the style** rather than adding a new class to a route's CSS module. CSS modules with copy-pasted rules are the failure mode this guide exists to prevent. If you find yourself inlining the same thing twice, lift it into a shared component instead.

## Migration status

- ✅ `<PageHeader />` exists and is exported from `@xchain-wallet/core/ui`.  
- ⬜ All existing routes use `<PageHeader />`.  
- ✅ Page templates (`FormPage`, `FormSection`, `ListPage`, `EmptyState`, `SectionHeader`) exist, are exported from `@xchain-wallet/core/ui`, and have style guide sections.  
- ✅ Proof conversions: Verify signature (`FormPage`), Payments due (`ListPage` + `EmptyState` + `SectionHeader`), Agent accounts (`ListPage` + `EmptyState`).  
- ⬜ Every remaining routed screen is built from one template. Converting a screen means: drop the `isFull ? styles.card` / `listCard` / `wrapFull` wrapper, put the body in the template, move errors into `status` and buttons into `actions`, and replace any per-route empty block with `EmptyState`.
- ✅ Application callers use `EmptyState`; `EmptyStateNudge` remains only as an unused downstream-compatibility export.

When you touch a route that still rolls its own header, card or empty state, please convert it. That's how the codebase converges over time without anyone having to do a big-bang refactor.
