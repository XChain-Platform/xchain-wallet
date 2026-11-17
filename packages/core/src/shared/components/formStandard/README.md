# Wallet Form Standard: shared frame

Every transaction form is its own fields placed in this one frame, top to bottom:  
title bar (the host's Screen + PageHeader), optional Quick | Full switch, **From**, the main section (open), other sections (closed), **Advanced**, **Speed and Fees**, the status slot, the action.  
Advanced comes with Speed and Fees and only with it (ruling G98): FeeSection draws it, so no form places it.  

Reference form: `shared/routes/Send.jsx`.  

## Pieces

| Export | What it is |
|---|---|
| `FormFrame` | The page body. Wraps `FormPage`; props `lead`, `view`/`onViewChange`, `from`, `fee`, `status`, `action`, `children`; every other prop goes to `FormPage` (`id`, `label`, `onSubmit`, `onChangeCapture`, `demoGuard`). |
| `FormSection` | The one collapsible section; its body holds every field 8px inside the box and 8px from the next (`--xc-form-gap` is 8px in there): `id`, `title`, `icon`, `optional`, `tag` (a second tag after Optional, e.g. Irreversible), `count` (shown at the trailing edge while open), `main` (data-form-main), `summary`, `summaryUnit`, `open`/`onOpenChange` or `defaultOpen`, `revealKey`. |
| `FromSection` | Required source section ("From", or `title="Signing with"`): Network + From address, summary "Bitcoin, bc1q...7c1c". `networkLabel` renames the Network field; `disabled` holds both fields while the form is busy; with no `onOpenPicker` (an address fixed by the action) the picker icon still shows, locked (`aria-disabled`, still focusable), and `pickerLockedReason` is its title ("The delegation's own address signs this clear"). |
| `MemoSection` | The optional Memo section when it holds only the memo: no field label row and no ? tip (the title already says Memo; the one exception to "every field has a tip"), a textarea named "Memo" by `aria-label` that shows one line, grows with the text to three, then scrolls inside (`Textarea autoGrow`; Enter adds no line break and never submits), and the "12 / 250" count in the header before the chevron while open. Section props as FormSection plus `inputId`; every other prop goes to the Textarea (`value`, `onChange`, `error`, `disabled`). A Memo section with more in it stays a FormSection with a labelled Input. |
| `AdvancedSection` | The optional "Advanced" section FeeSection draws directly above Speed and Fees inside a FormFrame; never placed by hand. Closed by default, marked Optional, summary "Default" or the choices that differ ("RBF on · 2 coins · custom change"). Open: "Allow a higher network fee later" (on by default wherever the network supports RBF unless the chain's Fees setting turned it off, and an untouched switch composes that default; off and locked with the reason on a network without RBF, where nothing is sent), Coin control (the source address's coins, Select All / Clear, dust tag, Selected total) and Change address (the read-only address field whose picker icon opens the own-address picker page, U60; Automatic first). Every option has its ? tip. Choices are kept per form and source address (`advancedOptions.js`), survive picker pages, and reset once a transaction is approved. |
| `withAdvancedOptions` | Folds the submitting form's Advanced choices into a compose request: `change` at the top (the host checks it is the wallet's own), `rbf` and `utxos` in `encoderOpts` with `actionData`, at the top otherwise. `useActionConfirmFlow` calls it on the shared route; a form composing on its own route wraps its request in it. A FormFrame submit (or a press of its action) arms the form; the confirmation's end disarms it, so an action outside the form never takes its choices. |
| `FeeSection` | The one "Speed and Fees" section on every form that pays a fee, closed by default. `advanced` turns Advanced options off for an action that cannot honour them: `false` drops the section, `{ coins: false, change: false }` drops those rows; on by default. Coin control also needs the FromSection address, and the change address the wallet (FormFrame reads it from `demoGuard`, or pass FormFrame `walletId`). Closed: the speed and the fee total in fiat ("Normal · ~$0.45"), coin amounts with no price ("Normal · 0.0000042 BTC + 10 XCHAIN"), a small spinner while the protocol fee loads. Open, nothing nested: the Slow / Normal / Fast / Custom slider with the time under each stop, the Network fee line (? tip, amount with its Edit control, fiat; the one custom fee editor, G113: sliding to Custom opens it in place and no second fee box appears), then, only with `fees` (quote, pending, `nativeFeeProps`), a thin rule, the Protocol fee line (? tip, amount, fiat) and the "Pay protocol fee in BTC" switch (converted amount under its label while on; on and locked with `mandatory`). No Total: it lives on the confirm screen. `fixedFee` (coin units) is the fixed-fee mode for a lane with no speed pick: no slider. |
| `FormStatusSlot` / `FormStatusScope` | The one notice and error slot above the action (FormFrame places both). |
| `FormAction` | Full-width green primary button with an icon, for `type="submit"` and `type="button"` alike; the label is a Title Case verb ("Sign Message"). |
| `useFormSections` | Host-held open state per section; `bind(id)` spreads `open` + `onOpenChange`, plus `main` for the section the form opens on load. |

Outside this folder: `NetworkField notSource` marks a Network field that is data, not the source network (Verify Signature's chain, LinkForm's per-card chain, Oracle's priced-token network, Bridge's Move to), so the From rule skips it; `RadioGroup` options take an `icon`; TileLookFields' colour swatches carry `data-form-swatch`.  
| `SummaryAddress`, `joinSummaryParts`, `summaryLineWithAddress` | An address in a summary line as the kit's fitting `AddressText` (whole when the line has room, cut in the middle only as needed, G99); joining strings and nodes ("a, b, c"); a translated line with the address at its placeholder. |
| `joinSummary`, `summaryAddress` | Plain-text helpers ("a, b, c"; a fixed "bc1q...7c1c" for a title or log line, never a summary on screen). |

**Name clash:** `ui/FormSection.jsx` (exported from `@xchain-wallet/core/ui`) is a different, non-collapsible block for settings pages. Import the standard one from `../components/formStandard/index.js`.  

## A plain form (Send)

```jsx
import { FeeSection, FormAction, FormFrame, FormSection, FromSection, useFormSections } from '../components/formStandard/index.js';

// Above every early return (pickers, review), so open state survives a picker page.
const sections = useFormSections({ from: false, payment: true, memo: false, fee: false });

if (sourcePickerOpen) return <OwnAddressPickerScreen ... onPick={...} onBack={...} />;

return wrap(
    <FormFrame
        id="send-form"
        label="Send"
        onSubmit={handleReview}
        lead={<PanicFreezeNotice surface="send" />}
        status={[errorSummary, offlineNotice, draftBanner]}
        action={<FormAction icon={<Icon.SendIcon />} loading={composing} disabled={blocked}>Send</FormAction>}
        from={(
            <FromSection
                {...sections.bind('from')}
                chainId={chainId}
                chainIds={chainIdsWithAddresses}
                chainRegistry={chainRegistry}
                onNetworkChange={onNetworkChange}
                address={fromAddress?.address}
                onOpenPicker={() => setSourcePickerOpen(true)}
                detail="0.4821 BTC available"
                missing={<FormNotice variant="error">No address on this network.</FormNotice>}
            />
        )}
        fee={(
            <FeeSection
                {...sections.bind('fee')}
                chainId={chainId}
                coinTicker="BTC"
                tiers={feeTiers}
                value={feePick}
                onChange={setFeePick}
                customEstimate={feeEstimate}
                error={feeError}
            />
        )}
    >
        <FormSection id="payment" title="Payment" icon={Icon.SendIcon} {...sections.bind('payment')}
            revealKey={paymentHasError ? validationAttempt + 1 : 0} summary="0.00125 BTC to bc1q...0a2">
            {/* To, Asset, Amount, extra recipients, Add recipient */}
        </FormSection>
        <MemoSection {...sections.bind('memo')} inputId="send-memo" maxLength={MAX_MEMO_LENGTH} value={memo} onChange={(e) => setMemo(e.target.value)} />
        {/* No Advanced here: FeeSection draws it above Speed and Fees. */}
    </FormFrame>,
);
```

## A Quick | Full form (Create Dispenser)

The view and the Full view's open sections come from the existing `useGiveGetView`; pass the view to `FormFrame` and render the sections each view shows.  

```jsx
const gg = useGiveGetView('dispenser', { sections: { from: false, dispenser: true, terms: false, fee: false } });
const bind = (id) => ({ open: Boolean(gg.sections[id]), onOpenChange: (open) => gg.setSectionOpen(id, open) });

return wrap(
    <FormFrame
        label="Create Dispenser"
        onSubmit={handleReview}
        view={gg.view}
        onViewChange={gg.setView}
        from={<FromSection {...bind('from')} chainId={chainId} chainRegistry={chainRegistry} lockNetwork={assetDecidesNetwork} address={source} onOpenPicker={openSourcePicker} />}
        fee={<FeeSection {...bind('fee')} chainId={chainId} coinTicker="BTC" tiers={tiers} value={feePick} onChange={setFeePick}
            fees={{ quote, pending, nativeFeeProps }} />}
        status={[errorSummary]}
        action={<FormAction icon={<Icon.PlusIcon />}>Create Dispenser</FormAction>}
    >
        <FormSection id="dispenser" title="Dispenser" icon={Icon.MarketIcon} {...bind('dispenser')}>
            {gg.view === 'quick' ? <GiveGetQuick ... /> : <FullFields ... />}
        </FormSection>
        {/* In Quick the terms row expands in place; it never switches to Full. */}
        <FormSection id="terms" title="Dispenser terms" icon={Icon.GearIcon} {...bind('terms')} summary="Default window, own address">
            ...
        </FormSection>
    </FormFrame>,
);
```

## Rules a migrating form must keep

- **Order:** `from`, then the main section (title names the action: Payment, Dispenser, Token), then other sections, then Advanced and `fee` (FeeSection draws both). The main section starts open; every other section, From included, starts closed.  
- **Optional tag:** only on optional sections (`optional`); never on From or the main section. An optional field inside a required section keeps its own Optional tag (the field's `optional` prop); inside an optional section it drops it.  
- **Summaries:** one line, current values ("0.00125 BTC to <address>", "None", "Default"). Put a trailing unit in `summaryUnit` so it drops before the text truncates at 360px. Draw an address with `<SummaryAddress address={...} />` (G99: whole when the line has room, cut in the middle only as much as it needs), never a fixed `summaryAddress` or `truncateAddress` string; join the parts with `joinSummaryParts`.  
- **Errors:** a section opens by itself when a field inside it turns `aria-invalid`. For errors raised on submit (the error summary), pass `revealKey={hasError ? validationAttempt + 1 : 0}` so each attempt reopens it even after the user closed it. Closed bodies stay mounted (`hidden`), so state, refs and error-summary focus targets survive.  
- **Notices:** pass the form's notices as FormFrame `status` (not FormPage `status`). Any `FormNotice` inside the body, and the fee selector's own notices, join the same slot just above the action. Only page-level notes that must lead the page (the panic freeze) go in `lead`. The slot carries `data-form-status`, so `useFocusNoticeOnAttempt` finds it.  
- **Action:** `FormAction` as FormFrame `action`, label a Title Case verb, never an amount or a ticker. FormFrame unwraps it into a real `Button` so FormPage's green submit applies. In a demo wallet the action stays enabled and no notice shows in advance; FormPage swallows the submit and the guard's refusal shows in the status slot. The submit still leads to the form's confirm step (ActionConfirmScreen).  
- **From:** FromSection is presentational. Keep the form's own source state (active address and its network by default) and its own `OwnAddressPickerScreen` early return; never a radio list. Pass `lockNetwork` when the picked asset decides the network. With no address the section opens and shows `missing`; pass `missing` only once the addresses have loaded (null while loading), or a slow read opens From for good.  
- **Pickers open as pages:** the host's early returns stay as they are; call `useFormSections` (or `useGiveGetView`) above them.  
- **One form, many actions:** where one form serves several actions (StakingForm, the List form in ListCreateForm.jsx), an Action field in the themed IconSelect, an icon per action, is the first field of the main section, and each list or route button opens the form with its action already picked. One config table says what each action shows, composes and checks. Network, From and memo carry across an action switch; a From the new action cannot sign with (a list owner) gives way to its own default. When a switch swaps bodies, the field that made the switch takes focus once the new body has loaded, and only once: the flag clears when taken, so a later picker or review return never steals focus. An action that needs something the form was not opened with (a list) stays in the Action field, disabled, with the reason in its help.  
- **Advanced:** compose through `useActionConfirmFlow` (default route) or wrap your own compose request in `withAdvancedOptions`; set FeeSection `advanced` for options your action cannot honour (fixed inputs or outputs).  
- **Test queries:** section headers are buttons named by their title plus summary (`aria-expanded`), and the `<section>` has no accessible name, so `getByLabelText('Memo')` still finds the field (a MemoSection names it by `aria-label`, and its open header name includes the count). Tests that type into a field of a closed section must open it first (click the header) or query with `{ hidden: true }`.  
