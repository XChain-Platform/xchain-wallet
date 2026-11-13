# Wallet Form Standard: shared frame

Every transaction form is its own fields placed in this one frame, top to bottom:  
title bar (the host's Screen + PageHeader), optional Quick | Full switch, **From**, the main section (open), other sections (closed), **Network fee**, the status slot, the action.  

Reference form: `shared/routes/Send.jsx`.  

## Pieces

| Export | What it is |
|---|---|
| `FormFrame` | The page body. Wraps `FormPage`; props `lead`, `view`/`onViewChange`, `from`, `fee`, `status`, `action`, `children`; every other prop goes to `FormPage` (`id`, `label`, `onSubmit`, `onChangeCapture`, `demoGuard`). |
| `FormSection` | The one collapsible section: `id`, `title`, `icon`, `optional`, `tag` (a second tag after Optional, e.g. Irreversible), `count` (shown at the trailing edge while open), `main` (data-form-main), `summary`, `summaryUnit`, `open`/`onOpenChange` or `defaultOpen`, `revealKey`. |
| `FromSection` | Required source section ("From", or `title="Signing with"`): Network + From address, summary "Bitcoin, bc1q...7c1c". `networkLabel` renames the Network field; `disabled` holds both fields while the form is busy; with no `onOpenPicker` the address has no picker icon (an address fixed by the order). |
| `FeeSection` | "Network fee": the existing `FeeSelector`, then `totals` rows, or the existing `FeesCard` via `fees` on protocol-fee forms. `fixedFee` (coin units) is the fixed-fee mode for a lane with no speed pick: no selector, a Network fee row (or `fees` without a selector). |
| `FormStatusSlot` / `FormStatusScope` | The one notice and error slot above the action (FormFrame places both). |
| `FormAction` | Full-width green primary button with an icon, for `type="submit"` and `type="button"` alike; the label is a Title Case verb ("Sign Message"). |
| `useFormSections` | Host-held open state per section; `bind(id)` spreads `open` + `onOpenChange`, plus `main` for the section the form opens on load. |

Outside this folder: `NetworkField notSource` marks a Network field that is data, not the source network (Verify Signature's chain, LinkForm's per-card chain, Oracle's priced-token network, Bridge's Move to), so the From rule skips it; `RadioGroup` options take an `icon`; TileLookFields' colour swatches carry `data-form-swatch`.  
| `summaryAddress`, `joinSummary` | Summary text helpers ("bc1q...7c1c"; "a, b, c"). |

**Name clash:** `ui/FormSection.jsx` (exported from `@xchain-wallet/core/ui`) is a different, non-collapsible block for settings pages. Import the standard one from `../components/formStandard/index.js`.  

## A plain form (Send)

```jsx
import { FeeSection, FormAction, FormFrame, FormSection, FromSection, useFormSections } from '../components/formStandard/index.js';

// Above every early return (pickers, review), so open state survives a picker page.
const sections = useFormSections({ from: false, payment: true, memo: false, advanced: false, fee: false });

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
                totals={[
                    { key: 'amount', label: 'Amount', value: '0.00125 BTC' },
                    { key: 'network', label: 'Network fee', value: '0.0000042 BTC' },
                    { key: 'total', label: 'Total', value: '0.0012542 BTC', strong: true },
                ]}
            />
        )}
    >
        <FormSection id="payment" title="Payment" icon={Icon.SendIcon} {...sections.bind('payment')}
            revealKey={paymentHasError ? validationAttempt + 1 : 0} summary="0.00125 BTC to bc1q...0a2">
            {/* To, Asset, Amount, extra recipients, Add recipient */}
        </FormSection>
        <FormSection id="memo" title="Memo" icon={Icon.MessageIcon} optional {...sections.bind('memo')} summary={memo || 'None'}>
            <Input id="send-memo" label="Memo" ... />
        </FormSection>
        <FormSection id="advanced" title="Advanced" icon={Icon.GearIcon} optional {...sections.bind('advanced')} summary="RBF on, auto coins">
            ...
        </FormSection>
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
            fees={{ quote, pending, nativeFeeProps }} protocolSummary="0.1 XCHAIN" />}
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

- **Order:** `from`, then the main section (title names the action: Payment, Dispenser, Token), then other sections, then `fee`. The main section starts open; every other section, From included, starts closed.  
- **Optional tag:** only on optional sections (`optional`); never on From or the main section. An optional field inside a required section keeps its own Optional tag (the field's `optional` prop); inside an optional section it drops it.  
- **Summaries:** one line, current values ("0.00125 BTC to bc1q...0a2", "None", "RBF on, auto coins"). Put a trailing unit in `summaryUnit` so it drops before the text truncates at 360px. Use `summaryAddress` (4 + 4), not `truncateAddress` (6 + 6).  
- **Errors:** a section opens by itself when a field inside it turns `aria-invalid`. For errors raised on submit (the error summary), pass `revealKey={hasError ? validationAttempt + 1 : 0}` so each attempt reopens it even after the user closed it. Closed bodies stay mounted (`hidden`), so state, refs and error-summary focus targets survive.  
- **Notices:** pass the form's notices as FormFrame `status` (not FormPage `status`). Any `FormNotice` inside the body, and the fee selector's own notices, join the same slot just above the action. Only page-level notes that must lead the page (the panic freeze) go in `lead`. The slot carries `data-form-status`, so `useFocusNoticeOnAttempt` finds it.  
- **Action:** `FormAction` as FormFrame `action`, label a Title Case verb, never an amount or a ticker. FormFrame unwraps it into a real `Button` so FormPage's green submit and demo disable apply. The submit still leads to the form's confirm step (ActionConfirmScreen).  
- **From:** FromSection is presentational. Keep the form's own source state (active address and its network by default) and its own `OwnAddressPickerScreen` early return; never a radio list. Pass `lockNetwork` when the picked asset decides the network. With no address the section opens and shows `missing`; pass `missing` only once the addresses have loaded (null while loading), or a slow read opens From for good.  
- **Pickers open as pages:** the host's early returns stay as they are; call `useFormSections` (or `useGiveGetView`) above them.  
- **Test queries:** section headers are buttons named by their title plus summary (`aria-expanded`), and the `<section>` has no accessible name, so `getByLabelText('Memo')` still finds the field. Tests that type into a field of a closed section must open it first (click the header) or query with `{ hidden: true }`.  
