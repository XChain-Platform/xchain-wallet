// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { registry as registryLib } from '@xchain-wallet/core';
import { Icon, Input } from '@xchain-wallet/core/ui';
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    useFormSections,
} from '@xchain-wallet/core/shared/components/formStandard/index.js';
import {
    GiveGetFull,
    GiveGetQuick,
    OwnershipToggle,
    QuickAddressRow,
    RateLine,
    ViewSwitch,
} from '@xchain-wallet/core/shared/components/giveGet/index.js';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { PartsExampleProvider, PART_ADDRESS, PART_CHAIN_ID } from './partsExamples.jsx';

const noop = () => {};
const chainRegistry = registryLib.defaultRegistry();

// Fixed fee tiers, so the closed Network fee summary reads the same on every visit.
const SAMPLE_TIERS = {
    low:    { coinAmount: '0.00001500', etaMinutes: 60, rate: '1 sat/vB', rateValue: 1 },
    normal: { coinAmount: '0.00003000', etaMinutes: 20, rate: '2 sat/vB', rateValue: 2 },
    fast:   { coinAmount: '0.00007500', etaMinutes: 10, rate: '5 sat/vB', rateValue: 5 },
    unit:   'sat/vB',
};

const TOTALS = [
    { key: 'amount', label: 'Amount', value: '0.00125 BTC' },
    { key: 'network', label: 'Network fee', value: '0.00003 BTC' },
    { key: 'total', label: 'Total', value: '0.00128 BTC', strong: true },
];

function SendFormExample({ id, fixedFee = null }) {
    const sections = useFormSections({ from: false, payment: true, memo: false, fee: false });
    const [fee, setFee] = useState({ mode: 'normal' });
    const [memo, setMemo] = useState('');
    return (
        <PartsExampleProvider>
            <FormFrame
                id={id}
                label="Send"
                onSubmit={(event) => event.preventDefault()}
                from={(
                    <FromSection
                        {...sections.bind('from')}
                        chainId={PART_CHAIN_ID}
                        chainRegistry={chainRegistry}
                        address={PART_ADDRESS}
                        onOpenPicker={noop}
                        note="0.4821 BTC available"
                    />
                )}
                fee={(
                    <FeeSection
                        {...sections.bind('fee')}
                        chainId={PART_CHAIN_ID}
                        coinTicker="BTC"
                        tiers={fixedFee ? null : SAMPLE_TIERS}
                        fixedFee={fixedFee}
                        value={fee}
                        onChange={setFee}
                        totals={TOTALS}
                    />
                )}
                action={<FormAction icon={<Icon.SendIcon />}>Send</FormAction>}
            >
                <FormSection
                    id="payment"
                    title="Payment"
                    icon={Icon.SendIcon}
                    main
                    {...sections.bind('payment')}
                    summary="0.00125 BTC to bc1q...0a2"
                >
                    <Input label="To" defaultValue={PART_ADDRESS} readOnly />
                    <Input label="Amount" defaultValue="0.00125" inputMode="decimal" />
                </FormSection>
                <FormSection
                    id="memo"
                    title="Memo"
                    icon={Icon.MessageIcon}
                    optional
                    {...sections.bind('memo')}
                    summary={memo || 'None'}
                >
                    <Input label="Memo" value={memo} onChange={(event) => setMemo(event.target.value)} />
                </FormSection>
            </FormFrame>
        </PartsExampleProvider>
    );
}

export function FormStandardSection() {
    return (
        <Section
            id="form-standard"
            title="Form Standard"
            tag="CANONICAL · FormFrame / FromSection / FormSection / FeeSection / FormAction"
            kicker="The one anatomy every transaction form uses: From, the main section, other sections, Network fee, the status slot, then one action."
        >
            <Guidance
                what={<><code>FormFrame</code> is the page body. <code>FromSection</code> holds Network and From address. <code>FormSection</code> is the one collapsible section (<code>main</code> marks the section the form opens on, <code>tag</code> adds a second tag after Optional, <code>count</code> shows a figure at the trailing edge while open). <code>MemoSection</code> and <code>AdvancedSection</code> are the collapsible Memo and Advanced sections. <code>FeeSection</code> is the Network fee row. <code>FormStatusSlot</code> is the single notice and error slot above the action, placed by <code>FormFrame</code>. <code>FormAction</code> is the full-width primary button.</>}
                when={<>Every form that signs or sends: place the form's own fields in these pieces, in this order.</>}
                whenNot={<>Settings pages and read-only screens: those use the non-collapsible <code>FormSection</code> from the UI barrel (the Form section entry above), which is a different component.</>}
                sizing={<>Sections stack 8px apart. A closed section shows a one-line summary and drops its unit (<code>summaryUnit</code>) before the text truncates at 360px.</>}
                variants={<>Main section open, every other section closed. <code>FeeSection</code> offers Slow, Normal, Fast or Custom, or <code>fixedFee</code> (coin units) for a lane with no speed pick: no selector, one Network fee row.</>}
                doRule={<>✓ Call <code>useFormSections</code> above every early return · pass notices through <code>FormFrame status</code> · label the action with a Title Case verb and an icon · mark Optional only on optional sections</>}
                dontRule={<>✗ Put an amount or ticker in the action label · tag From or the main section Optional · use a radio list for the source address · draw a one-off fee row</>}
                supersedes={<>Source: <code>shared/components/formStandard</code>. Reference form: <code>Send.jsx</code>.</>}
            />
            <Markup>
{`const sections = useFormSections({ from: false, payment: true, memo: false, fee: false });

<FormFrame
    label="Send"
    onSubmit={review}
    from={<FromSection {...sections.bind('from')} chainId={chainId} chainRegistry={registry} address={address} onOpenPicker={openPicker} />}
    fee={<FeeSection {...sections.bind('fee')} chainId={chainId} coinTicker="BTC" tiers={tiers} value={pick} onChange={setPick} totals={totals} />}
    status={[errorSummary]}
    action={<FormAction icon={<Icon.SendIcon />}>Send</FormAction>}
>
    <FormSection id="payment" title="Payment" icon={Icon.SendIcon} main {...sections.bind('payment')} summary="0.00125 BTC to bc1q...0a2">...</FormSection>
    <FormSection id="memo" title="Memo" icon={Icon.MessageIcon} optional {...sections.bind('memo')} summary="None">...</FormSection>
</FormFrame>

<FeeSection chainId={chainId} coinTicker="BTC" fixedFee="0.00003" totals={totals} />`}
            </Markup>
            <LiveExample label="Send: From, main Payment, optional Memo, Network fee, action" minHeight={520} padded={false}>
                <SendFormExample id="sg-form-standard" />
            </LiveExample>
            <LiveExample label="Fixed fee: no speed picker, one Network fee row" minHeight={520} padded={false}>
                <SendFormExample id="sg-form-standard-fixed" fixedFee="0.00003" />
            </LiveExample>
            <LiveExample label="FormSection main, tag and count" padded={false}>
                <PartsExampleProvider>
                    <FormFrame
                        id="sg-form-standard-tags"
                        label="Publish"
                        onSubmit={(event) => event.preventDefault()}
                        action={<FormAction icon={<Icon.CheckIcon />}>Publish</FormAction>}
                    >
                        <FormSection id="body" title="Message" icon={Icon.MessageIcon} main count="12 / 250" summary="12 characters">
                            <Input label="Text" defaultValue="Hello, world" />
                        </FormSection>
                        <FormSection id="lock" title="Lock supply" icon={Icon.LockIcon} optional tag="Irreversible" summary="Off">
                            <Input label="Note" />
                        </FormSection>
                    </FormFrame>
                </PartsExampleProvider>
            </LiveExample>
        </Section>
    );
}

const GIVE_ASSET = { chainId: 'bitcoin-mainnet', tick: 'BTC' };
const GET_ASSET = { chainId: 'bitcoin-mainnet', tick: 'PEPECASH' };

export function GiveGetStandardSection() {
    const [view, setView] = useState('quick');
    const [give, setGive] = useState('0.01');
    const [get, setGet] = useState('2500');
    const [sections, setSections] = useState({ give: true, get: true, options: false });
    const [selling, setSelling] = useState(false);
    const toggleSection = (id) => setSections((open) => ({ ...open, [id]: !open[id] }));
    return (
        <Section
            id="give-get"
            title="Give / Get"
            tag="CANONICAL · giveGet"
            kicker="The shared shape of Swap, Create Order, Dispenser and Cross-Chain Swap: one You give side, one You get side, in a Quick or a Full view of the same form state."
        >
            <Guidance
                what={<><code>ViewSwitch</code> picks Quick or Full. <code>GiveGetQuick</code> shows two big cards with a flip button, a rate line, an ownership group and one terms row. <code>GiveGetFull</code> shows collapsible You give and You get sections, then Options. <code>useGiveGetView</code> holds the view and the open sections per form.</>}
                when={<>A form that trades one asset for another and has a short path most people take.</>}
                whenNot={<>A one-sided form (Send, Issue Token): those use the Form Standard sections directly.</>}
                sizing={<>The cards fill the form column; the flip button sits in the gap between them. Toggles sit 8px above their content and never wrap at 360px.</>}
                variants={<>Quick and Full. In Quick the terms row expands in place and never switches to Full. Pickers open as pages through <code>onOpenAsset</code>.</>}
                doRule={<>✓ Keep one form state for both views · give the asset chip an accessible field name · pass <code>onFlip</code> only when the sides can swap</>}
                dontRule={<>✗ Keep two copies of the amounts, one per view · open a bottom sheet for the asset</>}
                supersedes={<>Source: <code>shared/components/giveGet</code>.</>}
            />
            <Markup>
{`const gg = useGiveGetView('swap');

<ViewSwitch value={gg.view} onChange={gg.setView} />
{gg.view === 'quick'
    ? <GiveGetQuick give={give} get={get} onFlip={flip} rate={<RateLine text="1 BTC = 250,000 PEPECASH" />} />
    : <GiveGetFull give={{ children: giveFields }} get={{ children: getFields }}
        sections={gg.sections} onToggleSection={gg.toggleSection} />}`}
            </Markup>
            <LiveExample label="Quick and Full views of one form" minHeight={520}>
                <PartsExampleProvider>
                    <ViewSwitch value={view} onChange={setView} />
                    {view === 'quick' ? (
                        <GiveGetQuick
                            give={{
                                asset: GIVE_ASSET,
                                assetLabel: 'Give token',
                                onOpenAsset: noop,
                                amount: give,
                                onAmountChange: setGive,
                                amountLabel: 'Give amount',
                                balanceText: 'Balance 0.4821',
                                onMax: noop,
                                address: <QuickAddressRow label="From" address={PART_ADDRESS} onPick={noop} />,
                            }}
                            get={{
                                asset: GET_ASSET,
                                assetLabel: 'Get token',
                                onOpenAsset: noop,
                                amount: get,
                                onAmountChange: setGet,
                                amountLabel: 'Get amount',
                            }}
                            onFlip={noop}
                            rate={<RateLine text="1 BTC = 250,000 PEPECASH" />}
                            ownership={{
                                children: (
                                    <OwnershipToggle label="Sell by name" checked={selling} onChange={setSelling} />
                                ),
                            }}
                        />
                    ) : (
                        <GiveGetFull
                            give={{ summary: `${give} BTC`, children: <Input label="Give amount" value={give} onChange={(event) => setGive(event.target.value)} /> }}
                            get={{ summary: `${get} PEPECASH`, children: <Input label="Get amount" value={get} onChange={(event) => setGet(event.target.value)} /> }}
                            options={{ summary: 'Default window', children: <Input label="Expiration" defaultValue="1000 blocks" /> }}
                            after={<RateLine text="1 BTC = 250,000 PEPECASH" />}
                            sections={sections}
                            onToggleSection={toggleSection}
                        />
                    )}
                </PartsExampleProvider>
            </LiveExample>
        </Section>
    );
}
