# XChain Wallet Style Guide

Living doc. The rule it exists to enforce: **if you find yourself copying CSS or JSX between two routes, lift it.** When in doubt, prefer one of the shared primitives below over re-rolling from scratch.

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
| `title` | centered title text |
| `titleIcon` | optional inline icon to the left of the title (accent-colored) |
| `backDisabled` | disables the back button while a submit is in flight; the chevron stays visible but inert |
| `trailing` | optional right-side slot for page-scoped actions (filter, scan, etc.); buttons render as circular 38px controls |

**Why the chevron alignment is non-obvious**: AppHeader pads its bar by `space-3` while Screen.header pads by `space-4`, so the toolbar content starts 4px too far right. On top of that, the back chevron glyph sits about 10px inside its own 28px SVG (the `BackIcon` vertex is at 9/24 of the viewBox), so a box-aligned button still reads indented. `<PageHeader />` subtracts both via `margin-inline-start: calc(var(--xc-space-3) - var(--xc-space-4) - var(--xc-page-header-chevron-nudge))` so the chevron's point lands under the AppHeader logo's left edge. The trailing slot mirrors the bar-padding delta on the right, and its buttons render as circular 38px controls (the round counterpart to AppHeader's square menu buttons) so their right edges line up with the App header buttons.

## Buttons

Use `<Button>` from `@xchain-wallet/core/ui` for anything button-shaped. Variants: `primary` (filled accent), `ghost` (transparent). Pass `loading` for spinner state.

For icon-only buttons inside layouts (e.g. an action overlaid in an input box), a plain `<button>` is fine, but make it transparent (no background, no border) so it reads as an icon affordance, not a tappable rectangle. The hover state should change icon color only, not paint a fill.

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

Don't use inline styles for normal inputs; keep the bump reserved for the few fields the user is most likely to interact with on a page.

## Amount field (with USD / coin swap)

The Send screen's amount input is the standard layout for any field that takes a transferable value. Three behaviors to reproduce when adding one elsewhere:

1. **Big-field styling** (the `style={…}` block above).
2. **Inline Max button** absolutely-positioned over the right padding of the input, never as a sibling that takes its own row.
3. **Live thousand-separator formatting**, with the canonical comma-free value stored in state. Use the `formatWithThousands` helper + the `countNonCommaBefore` / `indexAfterNonCommaCount` pair from `Send.jsx` so the cursor doesn't fling around as commas appear/disappear.
4. **Unit-swap footer**: a small button in the footer's left slot showing the derived value in the *other* unit ("≈ 12,345.67 USD" while typing coin, "≈ 0.001 BTC" while typing fiat). Tap to swap which unit is the input. Use `Icon.SwapIcon` for the affordance. Disabled / hidden when no `fiatRate` is available.
5. **Footer right** carries contextual hint ("X TICK available", "Loading…", "Balance unavailable"). Optional, but if present, keep it on the right so the swap button stays anchored on the left.

```jsx
<div className={`${styles.amountBlock} ${styles.bigField}`}>
    <div className={styles.amountFieldWrap}>
        <Input
            ref={amountInputRef}
            label={`Amount (${activeUnit})`}
            inputMode="decimal"
            value={formatWithThousands(inputValue)}
            onChange={(e) => onAmountFieldChange(e.target.value, e.target.selectionStart)}
            style={{ /* big-field bump */ }}
        />
        <button type="button" className={styles.amountMaxInline} onClick={onMax}>
            Max
        </button>
    </div>
    <div className={styles.amountFooter}>
        <button type="button" className={styles.amountUnitSwap} onClick={toggleAmountInputMode}>
            <Icon.SwapIcon /><span>{derivedText}</span>
        </button>
        <span className={styles.amountFooterRight}>{availableText}</span>
    </div>
</div>
```

**Canonical state rule:** whatever the user is typing in (fiat or coin), the value submitted to the network is always coin-scale. Keep a `fiatAmount` string for fidelity-of-display when the user is in fiat mode, and derive the canonical `amount` via `fiatToCoin` on every keystroke. Don't round-trip the user's typed string through the converter for re-display; that loses trailing zeros and disturbs the cursor.

## "To" field (recipient address)

Use `<AddressCombobox>` from `@xchain-wallet/core/ui`; it ships the autocomplete dropdown for contacts and recent recipients. Wrap it in the same `.bigField` treatment as Amount, and overlay any single quick action (address-book opener, QR scanner) as an absolutely-positioned button in the input's right padding, the same pattern Max uses on Amount.

```jsx
<div className={`${styles.toFieldWrap} ${styles.bigField}`}>
    <AddressCombobox
        label="To"
        value={toAddress}
        onChange={(e) => setToAddress(e.target.value)}
        onPaste={onAddressPaste}
        suggestions={suggestions}
        placeholder="Enter or paste an address or name…"
        style={{ /* big-field bump, paddingRight ~52px */ }}
    />
    <button
        type="button"
        className={styles.inlineContactsButton}
        onClick={openAddressBook}
        aria-label="Open address book"
    >
        <Icon.BookIcon />
    </button>
</div>
```

**Rules:**
- Always pass `suggestions`; it's what makes the combobox useful. Source them from contacts + recent send history scoped to the active chain.
- Treat paste as a special event (`onPaste`) so you can run paste-time validation (chain match, novelty check) before the value lands in state.
- Reserve right-padding (~52px per action) for inline buttons; do NOT stack icon buttons as siblings outside the input; they break the input's hit target.
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
| Receive | `ReceiveIcon` | hand-rolled (down arrow into tray) |
| Scan a QR | `CameraIcon` | hand-rolled (camera body + lens) |
| Address book / contacts | `BookIcon` | `BookOpen` |
| Filter | `FilterIcon` | `Filter` (funnel) |
| Search | `SearchIcon` | hand-rolled |
| More / menu | `MoreIcon` | hand-rolled (horizontal dots) |
| Settings | `GearIcon` | hand-rolled |
| Lock / Unlock | `LockIcon` / `UnlockIcon` | hand-rolled |

**Adding a new icon**: import the lucide source at the top of `icons/index.jsx`, wrap it in a thin export that passes `LUCIDE_PROPS` (matches the wallet's 18×18 size + stroke). Don't pull the icon directly at call sites; keep the indirection so we can swap one glyph for another without touching every route.

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

Never hard-code hex. Use `color-mix(in srgb, var(--xc-accent-primary) 70%, white 30%)` for hover tints; that pattern is in the existing `.back:hover` rule and survives theme swaps.

## Asset selector (tap to repick)

Whenever a screen has a currently-selected coin/token that the user may want to change, the affordance routes back to the picker (`ReceivePicker` / `SendPicker`). Two layout variants exist; pick the one that fits the screen, **and the click target follows from the layout**:

**Horizontal "asset card"**, used on Receive. Gray card row with the icon on the left, primary name + secondary tick or network kind on the right, a `›` chevron pinned right. **Whole card is the button**: the icon, the name area, the chevron, the empty padding all navigate. Discoverable as "this row is a picker", consistent with picker rows elsewhere (BalanceList).

```jsx
<button
    type="button"
    className={styles.assetCard}
    onClick={onChangeAsset}
    aria-label={`Change asset (currently ${assetName})`}
>
    <span className={styles.assetIconWrap}>
        <img className={styles.assetIcon} src={assetImageUrl} alt="" />
        {/* token rows also overlay a small chain pip, see Receive.jsx */}
    </span>
    <span className={styles.assetText}>
        <span className={styles.assetName}>{assetName}</span>
        {isToken ? <span className={styles.assetSub}>{tick}</span> : null}
    </span>
    <span className={styles.assetChevron} aria-hidden="true">›</span>
</button>
```

**Vertical "asset hero"**, used on Send. Large icon centered above a bold name. **Only the icon is tappable**: the name and surrounding whitespace stay inert. A hero element fills the row and would otherwise turn the entire top of the form into a navigation trap; scoping the hit target to the circular icon keeps the safe zone large.

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

**Rule of thumb for new screens:**
- A bounded card with content packed edge-to-edge and a visible chevron: make the whole card the button (horizontal variant).
- A standalone hero centered on its own row with airy whitespace: make only the icon the button (vertical variant).

**Rules for both variants:**

- The icon image renders with `object-fit: contain` and **no `border-radius`** on the image itself, so the published art keeps its shape (round / square / odd). Any focus ring goes on the wrapper, not the image.
- Native rows: image source is `branding.chainIconLargeUrl(descriptor.id)`. Non-native token rows: image source is the token's `imageUrl`, with `branding.chainIconSmallUrl(descriptor.id)` overlaid bottom-right as a small "pip" so the chain is still visible.
- If no image is available, fall back to a colored letter chip tinted via `tickerColor(tick)` (exported from `BalanceList.jsx`).
- The handler should always navigate to the picker (clear prefill, push `'<route>-picker'`). This stays true regardless of how the user arrived at the screen; a discoverable single-purpose action.

If a route needs an asset selector and you find yourself re-rolling the icon-resolution + chain-pip + fallback chain, lift it into a shared component before writing it a third time.

## When you can't reach for a primitive

If you genuinely need a one-off layout that doesn't fit any existing pattern, **inline the style** rather than adding a new class to a route's CSS module. CSS modules with copy-pasted rules are the failure mode this guide exists to prevent. If you find yourself inlining the same thing twice, lift it into a shared component instead.

## Migration status

- [x] `<PageHeader />` exists and is exported from `@xchain-wallet/core/ui`.
- [ ] All existing routes use `<PageHeader />`. Migration tracked in TODO.md.

When you touch a route that still rolls its own header, please convert it. That's how the codebase converges over time without anyone having to do a big-bang refactor.
