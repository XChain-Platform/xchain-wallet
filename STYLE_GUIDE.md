# XChain Wallet Style Guide

Living doc. The rule it exists to enforce: **if you find yourself copying CSS or JSX between two routes, lift it.** When in doubt, prefer one of the shared primitives below over re-rolling from scratch.

The live catalog is the style guide page, published at https://wallet.xchain.io/style-guide/ with every web deploy and served by the web dev server at `/style-guide/`. Its bar switches ordinary examples between Mobile (360px), Extension popup (400px) and Desktop (1024px) frames, and `?view=mobile|extension|desktop` in the URL opens a given view. Page-template examples instead show compact (360px), rail (768px), and full (1024px) widths together so the page gutter is visible at every layout tier.

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

### The page gutter and vertical rhythm

`Screen.body` owns the only page inset. It applies `padding: var(--xc-page-top) var(--xc-page-gutter)` (`ui/Screen.module.css`). Both tokens are 8px at every width and layout tier (`tokens.css`); the 640px and 900px blocks repeat the same value, so a tier can be given its own value later. Short landscape phones do not change them.

| layout | `--xc-page-gutter` | `--xc-page-top` |
|---|---:|---:|
| every layout | 8px | 8px |

Page templates and route content do not add another outer horizontal inset. `ListPage` stretches across the complete content box. `FormPage` is bare below 600px and becomes one centered 560px card at 600px and up. On the end edge the body uses `padding-inline-end: gutter - 2px - scrollbar lane`, so rows end on the header buttons' line. The global `AppHeader` is chrome with its own padding. `Screen.header` and `Screen.footer` are chrome too, but they read `--xc-page-gutter` for their inline padding so their edges line up with the body; they keep their own block padding.

Use the semantic rhythm tokens at their named level: `--xc-label-gap` and `--xc-help-gap` (4px) inside a field, `--xc-form-gap` (16px) between fields, `--xc-section-gap` (16px) between form sections, and `--xc-space-8` (32px) for a page-level break between content groups. A list page's blocks sit `--xc-list-page-gap` (8px) apart, a section header sits `--xc-section-header-gap` (8px) above its content, settings rows sit `--xc-settings-row-gap` (8px) apart, and a list row's padding is `--xc-list-row-padding` (8px). The page top inset always comes from `--xc-page-top`; do not recreate it with a first-child margin.

**Do:** let `<Screen>` provide `--xc-page-gutter` and use `<FormPage>` or `<ListPage>` directly inside it. **Do not:** add `padding-inline: 8px` to a route wrapper or stack arbitrary `margin-top` values between fields.

### The form rule: narrow is bare, wide is one card

One rule on every platform (phone, extension popup, desktop app, browser), decided by **viewport width with a CSS media query at 600px**:

- **Narrow, under 600px** (a phone, the 360 to 400px extension popup, a narrow desktop window): the form's fields sit bare on the page with only the page gutter. No card border, background or padding.
- **Wide, 600px and up**: the form sits in one card, a centred column 560px wide.
- **Long forms** are split into `<FormSection>`s inside `<FormPage sectioned>`: bare sections divided by a 1px rule at the section gap, sharing the form's one card when wide. A form built from its own section cards passes `cardless` so no card sits inside a card.
- **The action row** (`actions`) closes the form after the last field or section and wraps. Each button grows to share the row, so a lone button is full width; `stackedActions` stacks equal-width buttons. Put the primary action last so it lands on the right. A submit button (or, with no submit, the last primary button) is shown as `variant="success"` automatically; pass `choiceActions` to keep a list of equal choices as written.
- **Notices** go in `status` (or come from `errors`) and lead the form at the top, never beside the fields or the submit button.

The breakpoint is a viewport media query, not a container query. Chrome 102, the oldest Android WebView engine we support, has no container queries. The one exception is the wallet menu, which measures its own container under `@supports (container-type: inline-size)`. Do not choose the layout from the shell: a phone browser gets the narrow form and a wide desktop window gets the card. The sidebar nav appears at 640px, so 600 to 639px shows the bottom tab bar with a carded form; that is expected. Layout tiers are measured from the shell container (a 360px popup inside a wide window reads as compact), not the viewport.

**Do:** render the same `<FormPage>` markup at every width and let CSS make it bare or carded. **Do not:** branch on `screenVariantFor(shell)` or wrap wide forms in a route-local `.card`.

### Viewport width scale

Core CSS modules use this reviewed set of viewport widths. Choose the narrowest point that solves the layout problem instead of adding a nearby value.

| width | use |
|---|---|
| `360px` | the extension popup width: fallbacks at or below the popup |
| `400px` | extension-width detail layouts |
| `420px` | narrow row and toolbar stacking |
| `480px` | compact grids and dense controls |
| `600px` | the form and narrow route boundary |
| `640px` | rail layout and sidebar begin |
| `800px` (container, not viewport) | the wallet menu goes four columns |
| `834px` | wide licence terms use a centred two-thirds content column, and the wallet menu's four-column sheet width; menus, lists, and paired panels may gain columns |
| `900px` | full layout and labelled sidebar begin |
| `48rem` | wide collectible grids and the locked screen |
| `1024px` | desktop reference frame and future desktop-only refinements |

The current CSS-module audit uses `360px`, `400px`, `420px`, `480px`, `600px`, `640px`, `834px`, `900px`, and `48rem`. Prefer `not all and (min-width: N)` for a below-breakpoint rule, so the source names the real boundary without inventing `N - 1`; some older rules still use `max-width: N`. In particular, 600px remains on the wide side of the form rule. Values such as 359px, 399px, 599px, 601px, 639px, 833px, 899px, and 1023px are aliases, not additional breakpoints.

### The list rule: full width to the scrollbar

`<ListPage>` fills the Screen content box from `--xc-page-gutter` on the left to the page gutter and reserved scrollbar gutter on the right. Do not wrap it in a card or add a centered maximum width: lists, tables and card grids use all available content width at compact, rail, and full widths. The optional `toolbar` holds search, filter and sort; its first control takes the spare room and the rest wrap below it on a phone. A leading button keeps its own width. Give a search box `type="search"` and an `aria-label`.

### ListRow versus a card

Use `<ListRow>` for repeated, full-width items that share one reading order: optional leading identity, title and subtitle, trailing value, then one row-level navigation or action. Use a card when one item is a self-contained content group with its own hierarchy, several related values, or multiple internal actions. A card is content inside a `ListPage`, not a replacement for the page template or page gutter. Build a card by composing `.card` or `.flush` from `ui/Card.module.css`, never by drawing a border, radius, padding or background yourself; a card nested in a card flattens automatically.

**Do:** render each history transaction as a `<ListRow title="Sent XCH" trailing="-12.50 XCH" onClick={openTransaction} />`. **Do not:** put every transaction in its own card, or compress a portfolio summary with several actions into one `ListRow`.

### Props

| component | props |
|---|---|
| `Screen` | `variant` (`small` fills a 360px-wide host; `full` is flexible), `header`, `footer`, `children`. Screen hosts the shell's notices as the first thing in its scrolling body; a page never puts them in a header |
| `FormPage` | `onSubmit`, `actions`, `status` (a notice or an array of them), `errors` + `errorAction`, `intro`, `title` / `description` / `visual` / `headingAs` / `titleRef` (a self-titled form, e.g. onboarding), `progress`, `topAction`, `sectioned`, `cardless`, `fullWidth`, `fill`, `stackedActions`, `choiceActions`, `demoGuard`, `submitFromAnyField`, `as`, `label` (accessible name), `noValidate` (default `true`), `className`, `ref` (the form), `children`, and other form attributes |
| `FormSection` | `title`, `description`, `trailing`, `headingLevel` (`h2` default, or `h3`), `className`, `children`; with no title, description or trailing it draws no header |
| `ListPage` | `notices`, `actions` (the screen's own buttons; skip one the empty state already offers), `intro`, `toolbar`, `className`, `children`, and other root attributes such as `aria-label`; it lays out notices, actions, intro, toolbar, then content |
| `ListRow` | `title`, `subtitle`, `leading`, `trailing`, `chevron`, `href` (anchor), `onClick` (button), `type`, `tooltip`, `className`, `trailingClassName`, `contentClassName`; with neither `href` nor `onClick` it is a plain row |
| `EmptyState` | `title`, `body` (one line), `icon`, `actionLabel` + `onAction`, `actionIcon`, `actionVariant` (`success` default), `secondaryActionLabel` + `onSecondaryAction`, `secondaryActionIcon`, `showWhileUnavailable`, `titleAs` (`h2` default, or `h1`, `h3`, `p`), `role` (`status` default), `className`, and other root attributes. It steps aside while the shell's reachability notice is up (its actions stay), and with two or more on one screen each draws as a plain line |
| `SectionHeader` | `title`, `as` (`h2` default, or `h3` / `h4`), `id`, `description`, `trailing`, `className` |

```jsx
// A form screen
<Screen variant={variant} header={<PageHeader onBack={onBack} title="Verify signature" />}>
    <FormPage
        label="Verify signature"
        onSubmit={handleSubmit}
        status={error ? <Notice tone="danger">{error}</Notice> : null}
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

Every routed screen has a secondary toolbar below the global AppHeader. It carries: a back chevron, a centered title (with an optional one-line subtitle), and an optional trailing action slot.

**Use `<PageHeader />` from `@xchain-wallet/core/ui`.** Do not roll your own `.header` / `.back` / `.title` CSS.

```jsx
import { Screen, PageHeader, Icon } from '@xchain-wallet/core/ui';

const header = (
    <PageHeader
        onBack={onBack}
        title="Send"
        trailing={<button onClick={openScanner} aria-label="Scan QR"><Icon.CameraIcon /></button>}
    />
);

return <Screen variant={variant} header={header}>{...}</Screen>;
```

**Props**

| prop | meaning |
|---|---|
| `onBack` | when set, renders a back chevron; omit to render a leading spacer |
| `backLabel` | accessible label for the back button (default `Back to previous screen`) |
| `title` | centered title text: the page's one `<h1>`, one line with an ellipsis |
| `subtitle` | one small muted line under the title (a wizard's step) |
| `titleId` | id that names the screen body |
| `titleRef` | ref to move focus to the heading |
| `backDisabled` | disables the back button while a submit is in flight; the chevron stays visible but inert |
| `trailing` | optional right-side slot for page-scoped actions (filter, scan, etc.); buttons render as icon controls at the Back control size (small), with a touch-floor hit area, so the header keeps one height |
| `nested` | marks a sub-screen that shares its parent route id (a Settings section, a Contacts detail, a review step), so Back always shows |

**When Back shows**: the chevron follows the shell's one navigation history (G06). A page opened from another page (Token detail's Send or Receive, a market's Trade, any list row) shows Back, and Back returns to that page with its item. A root page, one opened from the sidebar, the bottom bar, the menu, the command palette or a go-to shortcut, shows none, since the history starts over on it and there is nothing to go back to. Shells open a root with `nav.navigateRoot` and a push with `nav.navigate`, and hand `nav.canGoBack` to `ShellRouteOutlet`, which PageHeader reads; outside a shell Back always shows. A sub-screen whose Back steps inside its page (a review step, a picker) passes `nested` and always shows Back. The leading lane keeps its width and the header keeps its height when Back is hidden, and the system Back gesture and Android Back still run `onBack`, which takes a root page to Home.

**Focus**: on route change, PageHeader moves focus to its `<h1>` unless a live control already has focus; it draws a focus box only after keyboard input.

**Why the chevron alignment is non-obvious**: Screen.header pads with `calc(var(--xc-page-gutter) - 2px)` and ends one gutter less 2px from the window edge, so the chevron lines up under the AppHeader logo. `<PageHeader />` is a 3-column grid with equal side lanes (at least 44px each) so the title stays on the header's centre; the chevron is a bare small button whose glyph is drawn a third of its box back to line up under the logo.

## Wallet menu

`packages/core/src/shared/walletMenu.js` is the one catalogue of wallet destinations. The header menu button, Cmd/Ctrl+K, the left nav and the bottom tab bar all read their rows from it, so a destination has one label, one icon and one view id on every shell and at every width. Add or rename a destination there and nowhere else; a component never hard-codes a menu label or icon.

- **One menu.** The header menu button and Cmd/Ctrl+K open the same surface, the command palette grown into the menu. With an empty query it shows the catalogue; typing filters with the palette search, and Enter runs the highlighted row. The menu header holds the search box, the extension's view switches (Open as popup, Open in sidebar, Open full screen), Lock wallet and Close.
- **Grouped boxes.** The catalogue has eight groups of seven rows (Wallet, Assets, Trade, Earn, Governance, People, Wallets, Actions), so every box is the same height. Settings is the last Wallet row. Lock wallet is an icon button in the menu header, left of Close. Rows are gated by wallet state (signer mode hides spending rows; the DEX, contracts, BTC and governance rows hide until the wallet can use them), and a group with no visible rows disappears. Each group is the shared `flush` card (a `1px solid var(--xc-border)` outline with the card radius) with its heading inside the box. The current view's row is highlighted (`aria-current="page"`).
- **Columns.** Boxes flow in menu order into a grid: two columns below 800px of container width, four from 800px (the iPad's 834px less both gutters), capped so 1280px and 1920px windows get the same sheet. The surface is the one scroller; a short screen scrolls to every box.
- **Presentation.** Below 640px of container width the menu is a full-height sheet with the search box in its top bar beside the action buttons. At 640px and wider it is a floating panel under the app bar at the end edge, at least 36rem wide (two columns), and four columns from 800px. Its accessible name is "Wallet menu" (a visually hidden heading on the dialog). The menu draws no Cmd/Ctrl+K hint; the hint belongs to the plain command palette.
- **Five-tab bar.** The bottom tab bar holds Home, Send, Receive, History and Settings, with no overflow tab and no sheet. In signer mode Send and Receive hide.
- **Left nav.** The sidebar chooses its own destinations and groups in `SIDEBAR_NAV_GROUPS` (`shared/routeRegistry.js`); only its labels and icons come from the catalogue. Settings and Lock wallet sit at its foot. The side menu has three states (hidden, icons, names); its edge tab and drag switch between them. A rail-width window showing names lays out as the full tier.
- **No unread dots.** The menu button, menu rows, sidebar and tab bar never show an unread dot or count; the notifications bell in the app header is the one place a count shows.

## Buttons

Use `<Button>` from `@xchain-wallet/core/ui` for anything button-shaped. Variants: `primary` (the one action the screen exists for), `secondary` (a second real action), `ghost` (cancel, back out, less-used actions), `danger` (destroys or spends irreversibly), `success` (approve a pending request), plus `link` (an inline text action) and `rowAction` (a compact transparent action inside a list row, whose glyph carries its state). Sizes follow the shared `sm` / `md` / `lg` control scale below. `block` makes it full width, `loading` overlays a spinner without resizing the button, sets `aria-busy` and ignores repeat taps, `disabled` ignores taps, and neither changes the button's colours (G130: a button never looks disabled). Never disable a button to wait for valid input: keep it enabled and answer the tap with the form's error summary and field messages (G129). `type` defaults to `button` so it never submits by accident. A `type="submit"` button left on `primary` is drawn in the success fill, so a form's main action reads as go; a submit that names another variant keeps it. `icon` accepts a node; omit it to pick an icon from the button's label when the label is a single plain string (`iconForLabel`), or pass `null` to suppress it. `iconPlacement` is `leading` (default), `trailing`, `leading-edge` or `trailing-edge` (icon pinned to the edge, label centred). An icon-only Button (icon, no children) requires `aria-label` or `aria-labelledby`, and takes its tooltip from the `aria-label`. Other native button attributes pass through. A variant name outside the seven above retains the base Button layout and size but has no variant color styling, so treat it as invalid. The style guide's Buttons section shows every supported combination.

## Notices, form errors and toasts

Use `<Notice>` from `@xchain-wallet/core/ui` for a message about the page the user is on (`StatusMessage` is the same component under its older name). It has three tones: `info`, `danger` (every warning, error and critical caution) and `success`. The look is one: a fill tinted in the tone, a thin border of the same tone, 8px corners, the tone icon, an optional bold `title`, the body, at most one `action` and an optional X (`onDismiss`). There is no solid red fill and no coloured edge bar, and a notice never sits inside a card. A static critical caution that is on the page from the first paint passes `role="note"` or `role={null}` so it is not a live region. `caution` gives the danger tone warning semantics (polite status role), `details` puts technical text in a collapsed disclosure, and `role` overrides the announcement (`alert`, `status`, `note`, or `null`). `StatusMessageGroup` merges several notices of one page into one box that takes the most severe tone. `PageNotice` and `FormNotice` are the page-level hosts.

A form that validates on submit uses `useFormErrors()` and hands the object to `FormPage` or `FormFrame` as `errors`: one danger notice ("Fix N things to continue" plus the list) at the top of the page, each failing field outlined red with its own line under it, both clearing as the user fixes the field.

A toast takes the same tones and icons over the raised surface: info, success, and danger for both its `warning` and `error` variants, with the X to dismiss. A toast may carry one action (`actionLabel` and `onAction`); `default` is drawn as info.

For dialogs use the shared `NoticeModal` (one OK) from `@xchain-wallet/core/shared/components/NoticeModal.jsx` and `ConfirmModal` (Cancel / Confirm, `danger` for destructive confirms) from `@xchain-wallet/core/shared/components/ConfirmModal.jsx`, never `alert()` or `confirm()`. `ConfirmModal` also takes `busy` (holds the dialog open while confirming) and `error` (shows a failure inside the dialog); both modals take `confirmLabel`.

For an icon action inside a field, use `FieldIconButton` through the field's `fieldAction` slot (or `clearable` / `revealable`) instead of a hand-built button. It is transparent and its hover changes the icon color only. Elsewhere, an icon-only `Button` needs an `aria-label`.

### Control sizes: sm, md and lg

Buttons and field primitives share one visual height scale. Pass the component's `size` prop instead of copying a height or padding rule, and keep controls that sit in the same row on the same size.

| size | token and height | use it when | do | do not |
|---|---|---|---|---|
| `sm` | `--xc-control-h-sm`, 28px (a `Button` stays 28px painted on touch; a field is 36px painted on touch) | a compact secondary control sits in a dense toolbar, table row, or filter cluster | `<Button size="sm">Clear</Button>` | shrink the primary submit action or an ordinary form field just to fit more content |
| `md` | `--xc-control-h-md`, 36px (44px on touch) | the control is a normal button, field, select, tab, or segmented choice; this is the default, and Send's To and Amount fields use it | omit `size` on a routine `<Input label="Memo" />` | invent a nearby route-local height such as 40px |
| `lg` | `--xc-control-h-lg`, 44px (48px on touch) | a rare, single prominent entry; no production screen uses it today | keep it for one standout entry | make every field large or mix `lg` and `md` in one aligned field stack |

On coarse-pointer or no-hover devices the tokens step up to 36/44/48px, so touch controls meet the 44px target at the default size, and form controls are forced to at least 16px text so iOS does not zoom on focus. The painted `sm` Button stays 28px on touch and grows only a transparent 44px target; an `sm` field follows the token to 36px. Do not increase a control's visible height to manufacture a touch target, and do not override control `font-size` in feature CSS.

## Inputs

Use `<Input>` from `@xchain-wallet/core/ui` for everything single-line. Pass-through props (`type`, `inputMode`, `autoComplete`, `style`) all forward to the underlying `<input>`. Pass `label` / `hint` / `error` for the labeled-input pattern. Other props: `help` (an InfoTip beside the label), `clearable` (an in-field X named "Clear <label>"), `revealable` (a show and hide button for password fields), `fieldAction` (one small in-field control), `counter` / `hideCounter`, `compactPlaceholder` (a shorter placeholder at phone width), `pasteGuard` (strips edge whitespace and refuses hidden characters on paste; decimal and number fields are paste-guarded automatically) and `optional`. A `datetime-local` field always adds a time-zone line. Its `size` prop is `sm` (28px, 36px painted on touch with a 44px target), `md` (36px, 44px on touch, default), or `lg` (44px, 48px on touch, with a weightier label). `Select`, `AmountField`, `AddressCombobox`, `ChainPicker` and `NetworkFilter` use the same `sm` / `md` / `lg` scale; `Textarea` offers `md` and `lg`. Any visibly compact control must keep its larger touch target outside the painted box. Every `<select>`, native or the shared `Select`, is styled globally (control height, border, radius, chevron), so never draw a custom arrow.

**Primary entry inputs.** Send's To and Amount fields use the default `md`; `lg` is available for a single prominent entry:

```jsx
<Input label="Amount" />
```

Do not duplicate the `lg` font, padding, or height with inline styles.

## Selection controls

### Chip versus SegmentedControl versus Tabs

Choose these by what the selection changes, not by which shape fits the available space.

| control | use it when | do | do not |
|---|---|---|---|
| `<Chip>` | a compact filter or preset can be toggled, or short metadata needs a static pill | use toggle chips for a Watchlist filter and a static chip for `BTC / LTC` | use a chip for a submit action or page navigation |
| `<SegmentedControl>` | exactly one of two or three short options sets an inline mode or view of the same content | use `Grouped / Flat` for history grouping | use it for independent booleans, long labels, or unrelated actions |
| `<Tabs>` | the choice replaces the primary panel inside the current routed page | use `Balances / NFTs / DeFi` above one connected tab panel | use tabs as data filters, nest tab strips, or place them in `PageHeader` |

Pass a boolean `pressed` (with `onPressedChange`) for a toggle chip; without it the chip is a static, non-interactive pill. `SegmentedControl` items take `id`, `label`, `disabled` and `tone` (`accent`, `success` or `danger`); the strip is a radio group with arrow-key navigation. `Tabs` items take `icon` and `count`; pass `panelId` so each tab controls its panel, and an `aria-label` on the strip.

### Checkbox versus Switch versus RadioGroup

Use `<Checkbox>` for a checkbox (`label`, `description`, `help`, `error`, `indeterminate`) and `<RadioGroup>` for a single-choice set. `ChoiceControl` is the lower-level checkbox-or-radio primitive, used only where those two do not fit (the sign-approval screen). A switch is `<Switch>`: a checkbox input with `role="switch"`, an optional icon, description and help. `ToggleRow` is the settings-card row around it. A group of on/off options on a form is an `OptionSwitchList` of `OptionSwitch` rows, never a checkbox list (G118).

| control | use it when | do | do not |
|---|---|---|---|
| Checkbox | each boolean can be selected independently, or an acknowledgement is submitted with a form | use a checkbox for an acknowledgement submitted with the form | use checkboxes when exactly one answer is required |
| Switch | one independent setting takes effect immediately when toggled | use a switch for `Hide small balances` and save the change on toggle | use a switch for a choice that waits for a Save or Continue action |
| RadioGroup | exactly one answer from a visible set is submitted as one form value | use a labelled group for `Slow / Normal / Fast` default fee priority | use radios for multiple selections or hide a long option list behind dozens of radio rows |

`RadioGroup` takes `legend`, `options` (each with an optional `icon` and `description`), `help`, `hint` and `error`; the Form Standard gives every option an icon.

### Required and optional fields

Mark optional fields, not required fields. Required fields use their plain label. An optional field takes the `optional` prop and shows the shared Optional pill beside its label. Never type `(optional)` or `(required)` into the label text; a literal trailing `(optional)` on a string label is stripped and drawn as the pill.

`Input`, `Select`, `Textarea` and `AmountField` take `optional`. The component draws the Optional pill, describes the field with it, and sets `aria-required="false"`. A plain string label is required by default (`aria-required="true"`). Pass `aria-required` to override, for a field whose optional state is shown elsewhere (a section header). The native `required` prop is still available when browser constraint validation is appropriate.

```jsx
<Input label="Account name" />
<Input label={t('send.memo')} optional />   {/* renders "Memo" with the Optional pill */}
<Select label="Network" value={chainId}>…</Select>
```

## Amount field (with USD / coin swap)

Use `<AmountField>` from `@xchain-wallet/core/shared/components/AmountField.jsx` for a transferable coin or token amount. It composes the shared `Input`, live thousand-separator formatting, an optional inline Max button, the coin / fiat swap footer, and optional balance text. It defaults to `size="md"`, and Send uses `md`.

The parent owns the values and conversion. `amount` is the canonical coin-scale string. In fiat mode, preserve the user's exact text in `fiatAmount` and derive `amount` with `fiatToCoin` on every keystroke. `onAmountFieldChange` receives the raw displayed value and cursor position. The reusable helpers live in `packages/core/src/shared/utils/amountFormat.js`: `formatWithThousands`, `countNonCommaBefore`, `indexAfterNonCommaCount`, and `normalizeAmountFieldInput` with `dropFieldGrouping` for per-keystroke normalisation.

`fiatRate` enables the unit-swap footer, which shows the derived value in the other unit. Without a rate, the swap control is hidden. `balanceText` fills the footer's right side with context such as "X TICK available", "Loading…", or "Balance unavailable". Without `onMax` the in-field Max icon shows disabled, so every amount field keeps the same shape; use `maxDisabled` while the balance is loading and `maxBusy` while the amount is being priced. `divisibility` caps coin-mode decimals and shows an inline precision error; `error`, `hint`, `help` and `label` forward to the Input; `disabled` holds the input and Max while the form is busy.

```jsx
import { AmountField } from '@xchain-wallet/core/shared/components/AmountField.jsx';

<AmountField
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

Use `<AddressCombobox>` from `@xchain-wallet/core/ui`; it ships the autocomplete dropdown for contacts and recent recipients. It accepts the shared `size` prop and owns one optional trailing action through `icon`, `onIconClick`, and `iconLabel`. Use `icon="contacts"` for the address-book action ("Open address book" by default) or `icon="addresses"` for an own-address picker ("Choose address"). Pass `onSuggestionSelect` to get the full suggestion (contact, recent) instead of just the address. Contact matches are capped at 50 while typing; the address-book icon reaches the rest.

```jsx
<AddressCombobox
    icon="contacts"
    iconLabel="Open address book"
    onIconClick={openAddressBook}
    label="To"
    help={toHelp}
    value={toAddress}
    onChange={(e) => setToAddress(e.target.value)}
    onSuggestionSelect={onSuggestionSelect}
    onPaste={onAddressPaste}
    suggestions={suggestions}
    placeholder="Enter an address or name…"
/>
```

**Rules:**
- Always pass `suggestions`; it's what makes the combobox useful. Source them from contacts + recent send history scoped to the active chain.
- Treat paste as a special event (`onPaste`) so you can run paste-time validation (chain match, novelty check) before the value lands in state.
- Let `AddressCombobox` reserve the right padding and position its icon action. Do not wrap it in another absolutely-positioned button.
- One inline action max (the most-used: typically Address Book). If you have more secondary actions (scan, say), move them to the toolbar's trailing slot or behind a `MoreIcon` overflow.
- No Paste button in or beside any field: users paste with the native menu and shortcuts, and `onPaste` sees that paste.

## Fee selector

`<FeeSelector>` from `@xchain-wallet/core/ui` is the fee priority control. It's a 3- or 4-stop slider (Slow / Normal / Fast / optional Custom, mode keys `low | normal | fast | custom`, each stop with its own glyph) over a native `<input type="range">` styled with `accent-color: var(--xc-accent-primary)`. On forms it is drawn by the Form Standard's `FeeSection`, which passes `allowCustom`; a route does not place `FeeSelector` itself. Use it directly only outside the Form Standard.

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
| `tiers` | required; from `estimateNativeSendFeeTiers` (sync seed) and/or `fetchNativeSendFeeTiers` (live SDK upgrade). With no usable tiers the selector shows no slider: on a known chain it opens on Custom with the rate as the one editable figure, and with no chain it shows only its header. |
| `chainId` | pass it so the selector can price the fee in fiat and name the unit. |
| `error` | a refusal about the fee (for example the node's relay minimum), shown under the readout. |
| `lineLabel` | the Fees section's "Network fee" label; the readout becomes that line. |
| `disabled` | read-only review states. |
| `value` / `onChange` | `{ mode, customRate? }`; mode is `'low' \| 'normal' \| 'fast' \| 'custom'`. |
| `coinTicker` | native coin symbol (BTC / LTC / DOGE) shown after the fee amount so it's clear which coin the fee is paid in. |
| `allowCustom` | default `true`. Set `false` on receive-style flows where the receiver only expresses a tier preference (custom sat/vB ages out by the time the QR is scanned). |
| `label` | renders inside the FeeSelector wrap so the label-to-slider gap matches the slider's internal rhythm. Skip your own outer label/title. |
| `customEstimate` | optional `FeeEstimate` for Custom mode so the readout stays live while the user edits. There is one custom editor, the fee amount (G113): typing a fee converts it to a rate (fee / size) and emits `{ mode: 'custom', customRate }`. With `allowCustom={false}` neither the Custom stop nor the click-to-edit readout appears. |

**Rules:**
- Always pull tiers via the helpers above; never compute fee rates inline. The async path upgrades the sync seed when live SDK data arrives.
- Receivers encoding a fee preference on a QR should always emit the picked tier (use the `feePriority` field on `xchainUri`). Senders scanning that URI seed `feePick.mode` from the prefill so the receiver's pick lands by default.
- If a chain has no fee estimate, FeeSelector opens on Custom and prices from the typed rate, so leave the section visible.

## Icons

The icon set lives in `packages/core/src/ui/icons/`. Some icons are lucide-react wrappers (they spread `LUCIDE_PROPS`) and most are hand-rolled inline SVGs (they spread `STROKE_PROPS`). Import icons by name, for example `import { SendIcon } from '.../ui/icons/index.jsx'`, and use them as `<SendIcon />`. `iconForLabel(label)` in `icons/index.jsx` picks the icon for a standard action label, so reuse it for consistent glyphs.

**Concept to glyph mapping** (so the same affordance reads the same way everywhere):

| Concept | Icon | Lucide source |
|---|---|---|
| Send | `SendIcon` | `Send` (paper airplane) |
| Receive | `ReceiveIcon` | `QrCode` (the same glyph as `QrCodeIcon` and `AddressIcon`) |
| Scan a QR (in-field button) | `QrCodeIcon` | `QrCode` |
| Scan (frame) | `ScanIcon` | `ScanLine` |
| Camera | `CameraIcon` | hand-rolled (camera body + lens) |
| Incoming | `IncomingIcon` | `ArrowDownLeft` (directional) |
| Max amount | `MaxIcon` | `ArrowUpToLine` |
| Token list | `TokenListIcon` | `LayoutList` |
| Verify | `VerifyIcon` | `ShieldCheck` |
| Copy | `CopyIcon` | hand-rolled |
| Back / chevron | `BackIcon`, `ChevronDownIcon` | hand-rolled |
| Close / dismiss | `XIcon` | hand-rolled |
| Address book / contacts | `BookIcon` | `BookOpen` |
| Filter | `FilterIcon` | `Filter` (funnel) |
| Search | `SearchIcon` | hand-rolled |
| More / menu | `MoreIcon` | `MoreHorizontal` |
| Settings | `GearIcon` | hand-rolled |
| Lock / Unlock | `LockIcon` / `UnlockIcon` | hand-rolled |

**Adding a new icon**: for a lucide glyph, import it at the top of `icons/index.jsx` and export a thin wrapper that spreads `LUCIDE_PROPS`. For a hand-drawn glyph, spread `STROKE_PROPS` on an `<svg>` with a 24x24 viewBox. Both already carry `data-xc-icon`, `aria-hidden` and the pixel fallback size (18). Add `data-xc-directional=""` to an arrow or chevron that must mirror in right-to-left layouts. Don't import lucide at call sites; keep the indirection so we can swap one glyph for another without touching every route.

Shared icons are sized by the `svg[data-xc-icon]` rule in `tokens.css`. A component selects a named size by setting `--xc-icon-size`; the rule defaults to `--xc-icon-md`, and it has zero specificity, so a component's own width and height still win. Keep literal pixel fallbacks in SVG `width`, `height`, or Lucide `size` props. Never put `var()` in an SVG sizing attribute because Chrome 102 can render the icon at its 300px default instead.

## Design tokens

Defined in `packages/core/src/ui/tokens.css`. Use the token instead of repeating its raw value in component styles, so theme and accessibility overrides apply uniformly.

### Spacing and typography

| Token | Value | Use for |
|---|---|---|
| `--xc-space-1` | 4px | gap inside compact controls |
| `--xc-space-2` | 8px | gap between sibling controls |
| `--xc-space-3` | 12px | control inline padding, badge padding |
| `--xc-space-4` | 16px | large-input horizontal padding |
| `--xc-space-5` | 20px | loose cluster spacing |
| `--xc-space-6` | 24px | large gaps |
| `--xc-space-8` | 32px | section breaks and page-level rhythm |
| `--xc-form-gap` | `var(--xc-space-4)` | gap between form fields |
| `--xc-label-gap` | `var(--xc-space-1)` | gap from a field label to its control |
| `--xc-help-gap` | `var(--xc-space-1)` | gap from a control to help or error text |
| `--xc-section-gap` | `var(--xc-space-4)` | gap between form sections |
| `--xc-section-header-gap` | `var(--xc-space-2)` | gap from a section header to its content |
| `--xc-settings-row-gap` | `var(--xc-space-2)` | gap between settings rows |
| `--xc-label-help-gap` | 2px | gap from a label's text to its help dot |
| `--xc-list-row-padding` | `var(--xc-space-2)` | inset inside a list row (8px everywhere) |
| `--xc-page-gutter` | 8px at every width | the sole inline page inset, applied by `Screen.body` |
| `--xc-page-top` | 8px everywhere | the sole page-content top inset, applied by `Screen.body` |
| `--xc-tap-min` | 24px | minimum pointer-target size at every width |
| `--xc-control-hit-min` | 24px; 44px on touch | hit-area floor for icon buttons |
| `--xc-font-sans` / `--xc-font-mono` | | the only font stacks; sans is the bundled Inter variable face |
| `--xc-text-xs` | 0.6875rem | metadata, hint text |
| `--xc-text-sm` | 0.8125rem | labels, secondary body text |
| `--xc-text-md` | 0.875rem | default body text and button labels |
| `--xc-text-lg` | 1rem | page title, large-control text |
| `--xc-text-xl` | 1.25rem | asset hero name, panel headings |
| `--xc-text-2xl` | 1.5rem | hero figures and prominent asset tickers |
| `--xc-control-h-sm` | 28px | compact control visual height; 36px on touch |
| `--xc-control-h-md` | 36px | default control visual height; 44px on touch |
| `--xc-control-h-lg` | 44px | hero control visual height; 48px on touch |
| `--xc-control-font` | `var(--xc-control-font-md)` | shared control text; `--xc-control-font-sm/-md/-lg` map to `--xc-text-sm/md/lg`, and on touch screens they become 1rem, 1rem and 1.0625rem |
| `--xc-control-pad-x` | `var(--xc-control-pad-x-md)` | shared control inline padding (sm 8px, md 12px, lg 16px); buttons use `--xc-button-pad-x-sm/-md/-lg` (12, 16, 20px) |
| `--xc-control-icon-sm/-md/-lg` | 16px / 20px / 24px | icons inside controls |
| `--xc-type-page-title-size/-weight` | `--xc-text-lg` / 700 | page titles |
| `--xc-type-section-title-size/-weight` | `--xc-text-md` / 700 | section titles |
| `--xc-type-card-title-size/-weight` | `--xc-text-md` / 600 | card titles |
| `--xc-type-body-size/-weight` | `--xc-text-sm` / 400 | body text |
| `--xc-prose-max-width` | 70ch | paragraph measure |

Use the type-role tokens for headings, not raw text tiers. Paragraphs are capped at 70ch by default; a component rule may set a shorter measure. An icon inside a field sits in a square slot, as far from the edge as from the top and bottom: use the `--xc-field-icon-inset-*` (picture), `--xc-field-glyph-inset-*` (bare 18px glyph) and `--xc-field-action-inset-*` (in-field icon button) tokens, with `--xc-field-icon-gap` (8px) between the icon and the text (G112).

### Icon sizes, radii, shadows and stacking

| Token | Value |
|---|---|
| `--xc-icon-xs` | 14px |
| `--xc-icon-sm` | 16px |
| `--xc-icon-md` | 18px |
| `--xc-icon-lg` | 20px |
| `--xc-icon-xl` | 24px |
| `--xc-radius-xs` | 2px |
| `--xc-radius-sm` | 4px |
| `--xc-radius-md` | 8px |
| `--xc-radius-lg` | 12px |
| `--xc-radius-pill` | 9999px |
| `--xc-control-radius` | 8px (`--xc-radius-control` aliases it) |
| `--xc-card-pad` | 8px |
| `--xc-card-radius` | `var(--xc-radius-md)` |
| `--xc-card-border` / `--xc-card-bg` | the card outline and fill (`--xc-surface-raised`) |
| `--xc-form-card-max-width` | 560px |
| `--xc-table-cell-padding-block/-inline` | 8px |
| `--xc-table-label-width` | 40% |
| `--xc-avatar-size-header/-list/-hero` | 28px / 40px / 88px |
| `--xc-avatar-pip-header/-list/-hero` | 14px / 20px / 32px |
| `--xc-avatar-shape` | `var(--xc-radius-pill)` |
| `--xc-menu-item-h` | `var(--xc-control-h-md)` |
| `--xc-menu-item-icon` | `var(--xc-icon-md)` |
| `--xc-badge-height-sm` | 24px |
| `--xc-badge-height-md` | 32px |
| `--xc-badge-radius` | `var(--xc-radius-pill)` |
| `--xc-badge-font-size-sm` | `var(--xc-text-xs)` |
| `--xc-badge-font-size-md` | `var(--xc-text-sm)` |
| `--xc-badge-font-weight` | 700 |
| `--xc-badge-icon-size-sm` | `var(--xc-icon-sm)` |
| `--xc-badge-icon-size-md` | `var(--xc-icon-xl)` |
| `--xc-badge-gap` | `var(--xc-space-1)` |
| `--xc-badge-padding-inline-sm` | `var(--xc-space-2)` |
| `--xc-badge-padding-inline-md` | `var(--xc-space-3)` |
| `--xc-shadow-sm` | 0 1px 2px rgba(15, 23, 42, 0.06) |
| `--xc-shadow-md` | 0 4px 12px rgba(15, 23, 42, 0.08) |
| `--xc-shadow-modal` | 0 16px 40px rgba(0, 0, 0, 0.35) |
| `--xc-z-base` | 1 |
| `--xc-z-sticky` | 20 |
| `--xc-z-dropdown` | 50 |
| `--xc-z-overlay` | 60 |
| `--xc-z-modal` | 1000 |
| `--xc-z-toast` | 9999 |

The shadow values above are the light theme; dark mode deepens them (sm rgba(0, 0, 0, 0.4), md rgba(0, 0, 0, 0.5), modal 0.6). Named shadow aliases point at these (`--xc-shadow-popover`, `-toast`, `-header-menu` use md; `-side-panel`, `-bottom-sheet` use modal); use the alias for the surface you are styling. Menus: `[role="menu"]` items and `[data-xc-menu-item]` rows are sized globally by the `--xc-menu-item-*` tokens (36px minimum height, 18px icon, one line with an ellipsis), so don't restyle them per feature.

Motion: use `var(--xc-transition)` and the `--xc-motion-*` tokens for every transition (`--xc-motion-duration-fast` 120ms, `-standard` 160ms, `-ambient` 1400ms, with the `--xc-motion-ease-*` curves). They collapse to near zero under reduced-motion and low-power settings, so don't hard-code durations. Blur and shadow effects go through `--xc-backdrop-filter`, `--xc-list-shadow` and `--xc-privacy-filter` so those modes can drop them; `--xc-secret-placeholder-filter` stays fixed so a hidden secret always looks hidden.

## Colors

Same source: `tokens.css`. Tokens resolve per theme: light by default, dark when the OS asks for it and the user has not forced Light, or when the user picks Dark (`data-xc-theme`). High-contrast (`prefers-contrast: more`) and Windows forced-colors blocks re-map them again, so never hard-code a color. Highlights:

| Token | Meaning |
|---|---|
| `--xc-text` | primary text |
| `--xc-text-muted` | secondary / label text |
| `--xc-accent-primary` | brand action fill (primary buttons, selected controls, checkbox and radio accent); pair its text with `--xc-on-accent`; `--xc-accent-primary-hover` is the hover fill |
| `--xc-accent-text` / `--xc-link` | accent-colored text, and inline links (underlined) |
| `--xc-surface` / `--xc-surface-raised` | page-level and raised surfaces; cards use `--xc-card-bg` (= `--xc-surface-raised`) |
| `--xc-bg-muted` | muted surface fill (disabled controls, chips, placeholders) |
| `--xc-row-hover-bg` / `--xc-row-active-bg` | row and menu-item hover and selected backgrounds |
| `--xc-border` / `--xc-border-strong` | control and region borders (`--xc-border-strong` aliases `--xc-border`; both clear the 3:1 non-text floor) |
| `--xc-focus-ring` | keyboard focus ring, drawn globally (2px, inset) on every focusable element |
| `--xc-skeleton` | loading placeholders |
| `--xc-hero-*`, `--xc-toggle-selected-*` | the brand balance-card palette (bg, text, chart, chips, pills) with its own contrast set |
| `--xc-control-*`, `--xc-switch-on` | shared control bg, border, hover, selected, focus and disabled colors; the switch-on color |
| `--xc-outcome-*`, `--xc-on-outcome` | prediction market outcome marks |
| `--xc-badge-multisig-*` | multisig script-type badge colors |
| `--xc-brand-blue`, `--xc-brand-purple`, `--xc-brand-gradient` | brand colors |
| `--xc-danger`, `--xc-danger-fg`, `--xc-danger-bg`, `--xc-danger-text`, `--xc-on-danger` | danger actions, glyphs, tinted panels, panel text and text on danger fills |
| `--xc-info`, `--xc-info-bg`, `--xc-info-text` | informational accents, tinted panels and panel text |
| `--xc-warning`, `--xc-warning-bg`, `--xc-warning-text` | warning accents, tinted panels and panel text |
| `--xc-success`, `--xc-success-fill`, `--xc-success-bg`, `--xc-on-success` | success text and glyphs, the main action fill (brighter green, also the switch-on color), tinted panels, and text on success fills (white on light, near-black on dark) |

Do not hard-code interface colors in components. Use tokens, or `color-mix(in srgb, <token> N%, transparent)` for a derived tint (see `--xc-hero-chart-fill` and `--xc-shadow-status-halo` in `tokens.css`). For text, use `--xc-accent-text` and `--xc-danger-fg` rather than the fill tokens `--xc-accent-primary` and `--xc-danger`, which fail AA as text on dark cards; text on fills uses `--xc-on-accent`, `--xc-on-danger` and `--xc-on-success`. Token definitions, encoded image data, and data-driven semantic palettes are the places where literal color values belong.

Keyboard focus is drawn globally with `--xc-focus-ring`; don't set `outline: none` on a control without replacing the ring. Disabled fields use saturation, not opacity, so contrast holds; a disabled or busy button keeps its colors.

## UI copy

Use sentence case for page titles, headings, buttons, menu items, field labels and status messages. Preserve the normal spelling of proper nouns, tickers and initialisms.

In user-facing copy, say **recovery phrase**, not seed phrase or mnemonic, and **network fee**, not transaction fee, miner fee or gas fee. Protocol-specific fees remain distinct from the network fee.

## Browser baseline

Chrome 102 is the oldest supported Android WebView engine. CSS and SVG must keep working there. Prefer viewport media queries. A container query is allowed only inside an `@supports (container-type: inline-size)` guard, with a base rule that still lays out correctly without it. Guard newer viewport units such as `dvh` with `@supports`, and never use `var()` in SVG sizing attributes.

`body` carries the top and side safe-area insets. Size full-height shells with `--xc-viewport-h`, not `100vh` or `100dvh`, and don't add a bottom inset in a feature; BottomTabBar, LeftNav and Screen own it.

## Asset selectors (tap to repick)

Use `<TokenField>` from `@xchain-wallet/core/shared/components/TokenField.jsx` for the normal in-form asset selector. It is a field-shaped button that displays the `TickerIcon` (with its chain pip), the ticker, and a trailing token-list icon; the chain name is carried only in the accessible name. The entire field opens the host-owned `TokenPicker`. It accepts `label` (`Token` default), `size` (`md` default or `lg`), `value`, `onOpenPicker`, `placeholder` (`Select a token` default), `disabled`, `error`, `id`, `formErrorKey`, `optional` and `help`. With a form on the form error standard (`useFormErrors`), the field reads its error entry by `id` (or `formErrorKey`), outlines red, and clears the entry when a new token is picked.

```jsx
<TokenField
    label="Token"
    value={{ chainId, tick }}
    onOpenPicker={openTokenPicker}
/>
```

`TokenField` resolves the token art, chain pip, and letter fallback through the shared `TickerIcon`, so routes should not duplicate that chain. Creating a new ticker remains a free-text `Input`; a token fixed by route context should use the read-only `LockedTokenContext` instead.

**Asset hero**, used on Send, is the deliberate exception: `SelectedTokenHero` (exported from `shared/routes/Send.jsx`) draws an 88px circular icon, and only the icon is tappable. With `onChangeAsset` the icon is a ghost `Button` named "Change asset (currently X)"; without it, the hero is a plain `aria-hidden` element. Scoping the hit target to the icon keeps the top of the form from becoming a navigation trap.

```jsx
<SelectedTokenHero chainId={chainId} tick={tick} descriptor={descriptor} onChangeAsset={openPicker} allowRemoteImages={false} />
```

**Hero rules:**

- The artwork is 88px and round (`border-radius: 50%`, `object-fit: cover`, a 1px `--xc-border`). The focus ring sits on the wrapper with a `--xc-space-1` offset.
- Native assets use `branding.chainIconLargeUrl(descriptor.id)`. Non-native tokens use the token's `imageUrl` when `isAssetImageSourceAllowed(...)` passes, with `branding.chainIconSmallUrl(chainId)` overlaid bottom-right as a 32px pip so the chain is still visible.
- With no image, it falls back to a letter chip tinted by `tickerColor(tick)` (defined in `ui/AssetMark.jsx` and re-exported from `BalanceList.jsx`).
- The host owns picker navigation and writes the selected `{ chainId, tick }` back into route state. Preserve the rest of the form state across that round trip.

If a route needs an asset selector, use `TokenField` (in a form) or `SelectedTokenHero` (Send's hero) rather than reimplementing icon resolution, the chain pip, and fallback behavior.

## When you can't reach for a primitive

If you genuinely need a one-off layout that doesn't fit any existing pattern, **inline the style** rather than adding a new class to a route's CSS module. CSS modules with copy-pasted rules are the failure mode this guide exists to prevent. If you find yourself inlining the same thing twice, lift it into a shared component instead.

## Migration status

- ✅ `<PageHeader />` exists, is exported from `@xchain-wallet/core/ui`, and is used by nearly every routed screen.  
- ✅ Page templates (`FormPage`, `FormSection`, `ListPage`, `EmptyState`, `SectionHeader`) exist, are exported from `@xchain-wallet/core/ui`, have style guide sections, and are adopted across the routed screens (`FormPage` in about 69 route files, `ListPage` in about 92, `EmptyState` in about 54).  
- ⬜ A few routed screens still roll their own `listCard` wrapper: `BetFeedDetail`, `MarketActivity`, `OracleConsole` and `IssueTokenForm`. Converting one means: put the body in the template, move errors into `status` and buttons into `actions`, and replace any per-route empty block with `EmptyState`. The `isFull ? styles.card` and `wrapFull` patterns are gone.  
- ✅ Application callers use `EmptyState`; `EmptyStateNudge` (`shared/components/EmptyStateNudge.jsx`) is no longer referenced by any route or component.

When you touch a route that still rolls its own header, card or empty state, please convert it. That's how the codebase converges over time without anyone having to do a big-bang refactor.
