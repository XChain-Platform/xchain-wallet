// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Canonical component style guide: the single source of truth for the
// wallet's reusable component vocabulary. Add a new <Section> for each
// component as it's documented. Sections render in the order declared
// in `SECTIONS` below; the TOC is generated from that list.
import { useState } from 'react';
import { Checkbox, ChoiceControl, RadioGroup, SegmentedControl } from '@xchain-wallet/core/ui';
import { VIEWS, ViewContext, ViewFrame, ViewportFrame, useViewState } from './frames.jsx';
import { ComponentStateMatrix } from './ComponentStateMatrix.jsx';
import {
    DesignTokensSection,
    DOCUMENTED_TOKENS,
    TOKEN_GROUPS,
} from './sections/DesignTokensSection.jsx';
import { TypographySection } from './sections/TypographySection.jsx';
import { SpacingSection } from './sections/SpacingSection.jsx';
import { IconsSection } from './sections/IconsSection.jsx';
import { AppHeaderSection } from './sections/AppHeaderSection.jsx';
import { PageHeaderSection } from './sections/PageHeaderSection.jsx';
import { TabsSection } from './sections/TabsSection.jsx';
import { QuickActionSection } from './sections/QuickActionSection.jsx';
import { GrayCardSection } from './sections/GrayCardSection.jsx';
import { AccentBorderedCardSection } from './sections/AccentBorderedCardSection.jsx';
import { StackedAssetIconSection } from './sections/StackedAssetIconSection.jsx';
import { AssetHeroSection } from './sections/AssetHeroSection.jsx';
import { AssetCardSection } from './sections/AssetCardSection.jsx';
import { BalanceListSection } from './sections/BalanceListSection.jsx';
import { TokenSelectorSection } from './sections/TokenSelectorSection.jsx';
import { AddressListSection } from './sections/AddressListSection.jsx';
import { PillSegmentedSection } from './sections/PillSegmentedSection.jsx';
import { ToggleBarSection } from './sections/ToggleBarSection.jsx';
import { FieldSizesSection } from './sections/FieldSizesSection.jsx';
import { AmountFieldSection } from './sections/AmountFieldSection.jsx';
import { AddressFieldSection } from './sections/AddressFieldSection.jsx';
import { TokenFieldSection } from './sections/TokenFieldSection.jsx';
import { ChainPickerSection } from './sections/ChainPickerSection.jsx';
import { NetworkFieldSection } from './sections/NetworkFieldSection.jsx';
import { FeeSelectorSection } from './sections/FeeSelectorSection.jsx';
import { VoiceSection } from './sections/VoiceSection.jsx';
import { StatesSection } from './sections/StatesSection.jsx';
import { PrivacyModeSection } from './sections/PrivacyModeSection.jsx';
import { PageTemplatesSection } from './sections/PageTemplatesSection.jsx';
import { FormPageSection } from './sections/FormPageSection.jsx';
import { FormErrorSummarySection } from './sections/FormErrorSummarySection.jsx';
import { FormSectionSection } from './sections/FormSectionSection.jsx';
import { ListPageSection } from './sections/ListPageSection.jsx';
import { ListRowSection } from './sections/ListRowSection.jsx';
import { EmptyStateSection } from './sections/EmptyStateSection.jsx';
import { SectionHeaderSection } from './sections/SectionHeaderSection.jsx';
import { ButtonsSection } from './sections/ButtonsSection.jsx';
import { ChipSection } from './sections/ChipSection.jsx';
import { SwitchSection } from './sections/SwitchSection.jsx';
import { DialogsSection } from './sections/DialogsSection.jsx';
import {
    AddressComboboxSection,
    IconSelectSection,
} from './sections/ChoicePrimitivesSection.jsx';
import {
    AddressTextSection,
    ChainBadgeSection,
    CopyButtonSection,
    InfoTipSection,
    MultisigBadgeSection,
    VerifiedBadgeSection,
} from './sections/DisplayPrimitivesSection.jsx';
import {
    AnimatedQrFramesSection,
    QrScannerSection,
} from './sections/QrPrimitivesSection.jsx';
// Curated catalog: patterns we've established across the recent work
// (Home, Receive, Send, TokenDetail). Add a section here when a new
// pattern lands in two routes or you want to codify a one-off as
// canonical going forward.

export const SECTIONS = [
    { id: 'design-tokens',         label: 'Design tokens',          Component: DesignTokensSection },
    { id: 'typography',            label: 'Typography',             Component: TypographySection },
    { id: 'spacing',               label: 'Spacing & radii',        Component: SpacingSection },
    { id: 'icons',                 label: 'Icon catalog',           Component: IconsSection, primitives: ['Icon'] },
    { id: 'page-templates',        label: 'Page templates',         Component: PageTemplatesSection, primitives: ['Screen'] },
    { id: 'form-page',             label: 'Form page',              Component: FormPageSection, primitives: ['FormPage'] },
    { id: 'form-error-summary',    label: 'Form error summary',     Component: FormErrorSummarySection, primitives: ['FormErrorSummary', 'FormNotice'] },
    { id: 'form-section',          label: 'Form section',           Component: FormSectionSection, primitives: ['FormSection'] },
    { id: 'list-page',             label: 'List page',              Component: ListPageSection, primitives: ['ListPage'] },
    { id: 'list-row',              label: 'List row',               Component: ListRowSection, primitives: ['ListRow'] },
    { id: 'empty-state',           label: 'Empty state',            Component: EmptyStateSection, primitives: ['EmptyState'] },
    { id: 'section-header',        label: 'Section header',         Component: SectionHeaderSection, primitives: ['SectionHeader'] },
    { id: 'buttons',               label: 'Buttons',                Component: ButtonsSection, primitives: ['Button', 'Spinner'] },
    { id: 'checkbox',              label: 'Checkbox',               Component: CheckboxSection, primitives: ['Checkbox'] },
    { id: 'choice-control',        label: 'Choice control',         Component: ChoiceControlSection, primitives: ['ChoiceControl'] },
    { id: 'chip',                  label: 'Chip',                   Component: ChipSection, primitives: ['Chip'] },
    { id: 'switch',                label: 'Switch',                 Component: SwitchSection, primitives: ['Switch'] },
    { id: 'dialogs',               label: 'Dialogs and notices',    Component: DialogsSection },
    { id: 'app-header',            label: 'App header',             Component: AppHeaderSection },
    { id: 'page-header',           label: 'Page header',            Component: PageHeaderSection, primitives: ['PageHeader'] },
    { id: 'tabs',                  label: 'Tabs (page-level)',      Component: TabsSection, primitives: ['Tabs'] },
    { id: 'quick-action',          label: 'Quick-action card',      Component: QuickActionSection },
    { id: 'gray-card',             label: 'Card',                   Component: GrayCardSection },
    { id: 'solid-accent-card',     label: 'Solid accent card',      Component: AccentBorderedCardSection },
    { id: 'stacked-asset-icon',    label: 'Stacked asset icon',     Component: StackedAssetIconSection },
    { id: 'asset-hero',            label: 'Asset hero (Send)',      Component: AssetHeroSection },
    { id: 'asset-card',            label: 'Asset card (Receive)',   Component: AssetCardSection },
    { id: 'balance-list',          label: 'Balance / search list',  Component: BalanceListSection },
    { id: 'token-selector',        label: 'Token selector page',    Component: TokenSelectorSection },
    { id: 'address-list',          label: 'Address list (contacts)',Component: AddressListSection },
    { id: 'radio-group',           label: 'Radio group',            Component: RadioGroupSection, primitives: ['RadioGroup'] },
    { id: 'segmented-control',     label: 'Segmented control',      Component: SegmentedControlSection, primitives: ['SegmentedControl'] },
    { id: 'pill-segmented',        label: 'Pill segmented',         Component: PillSegmentedSection },
    { id: 'toggle-bar',            label: 'Toggle bar (filter)',    Component: ToggleBarSection },
    { id: 'field-sizes',           label: 'Field sizes',            Component: FieldSizesSection, primitives: ['Input', 'Select', 'Textarea'] },
    { id: 'icon-select',           label: 'Icon select',            Component: IconSelectSection, primitives: ['IconSelect'] },
    { id: 'address-combobox',      label: 'Address combobox',       Component: AddressComboboxSection, primitives: ['AddressCombobox'] },
    { id: 'amount-field',          label: 'Amount field',           Component: AmountFieldSection },
    { id: 'address-field',         label: 'Address field',          Component: AddressFieldSection, primitives: ['AddressField'] },
    { id: 'token-field',           label: 'Token field',            Component: TokenFieldSection },
    { id: 'chain-picker',          label: 'Network picker',           Component: ChainPickerSection, primitives: ['ChainPicker'] },
    { id: 'network-field',         label: 'Network field',          Component: NetworkFieldSection, primitives: ['NetworkField'] },
    { id: 'fee-selector',          label: 'Fee selector',           Component: FeeSelectorSection, primitives: ['FeeSelector'] },
    { id: 'chain-badge',           label: 'Network badge',            Component: ChainBadgeSection, primitives: ['ChainBadge'] },
    { id: 'address-text',          label: 'Address text',           Component: AddressTextSection, primitives: ['AddressText'] },
    { id: 'copy-button',           label: 'Copy button',            Component: CopyButtonSection, primitives: ['CopyButton'] },
    { id: 'multisig-badge',        label: 'Multisig badge',         Component: MultisigBadgeSection, primitives: ['MultisigBadge'] },
    { id: 'verified-badge',        label: 'Verified badge',         Component: VerifiedBadgeSection, primitives: ['VerifiedBadge'] },
    { id: 'info-tip',              label: 'Info tip',               Component: InfoTipSection, primitives: ['InfoTip'] },
    { id: 'animated-qr-frames',    label: 'Animated QR frames',     Component: AnimatedQrFramesSection, primitives: ['AnimatedQrFrames'] },
    { id: 'qr-scanner',            label: 'QR scanner',             Component: QrScannerSection, primitives: ['QrScanner'] },
    { id: 'voice',                 label: 'Voice & microcopy',      Component: VoiceSection },
    { id: 'states',                label: 'Loading / empty / error',Component: StatesSection, primitives: ['Skeleton', 'StatusMessage'] },
    { id: 'privacy-mode',          label: 'Privacy mode',           Component: PrivacyModeSection },
];

export const DOCUMENTED_PRIMITIVES = Object.freeze(
    SECTIONS.flatMap(({ primitives = [] }) => primitives),
);

export { DOCUMENTED_TOKENS, TOKEN_GROUPS };

function CheckboxSection() {
    return (
        <Section
            id="checkbox"
            title="Checkbox"
            tag="CANONICAL · Checkbox"
            kicker="A native checkbox with a token-styled box, supporting text, validation, and a label-wide 44px touch target."
        >
            <Guidance
                what={<>A semantic <code>input type="checkbox"</code> with <code>label</code>, optional <code>description</code> and <code>error</code>, plus checked, indeterminate, disabled, and error visuals.</>}
                when={<>Use it for independent yes/no choices and acknowledgements in forms.</>}
                whenNot={<>Use radio buttons or a select when the user must choose exactly one item from a set.</>}
                sizing={<>The painted box uses <code>--xc-control-icon-md</code>; the surrounding label remains at least 44px tall on every pointer type.</>}
                variants={<>Unchecked, checked, indeterminate, disabled, and error states in both light and dark themes.</>}
                doRule={<>Keep the complete label meaningful and add a description only when it helps the user decide.</>}
                dontRule={<>Do not replace it with a clickable image or remove the native input from the accessibility tree.</>}
            />
            <Markup>
{`<Checkbox
    label="Publish permanently"
    description="On-chain bytes cannot be deleted."
    checked={accepted}
    onChange={(event) => setAccepted(event.target.checked)}
/>
<Checkbox label="Select all files" indeterminate />
<Checkbox label="Accept terms" error="Required" />`}
            </Markup>
            <LiveExample label="Default, supporting text, indeterminate, disabled, and error states">
                <div style={{ display: 'grid', gap: 'var(--xc-space-2)' }}>
                    <Checkbox label="Publish permanently" description="On-chain bytes cannot be deleted." defaultChecked />
                    <Checkbox label="Select all files" indeterminate />
                    <Checkbox label="Managed by your organization" disabled checked readOnly />
                    <Checkbox label="Accept terms" error="Required" />
                </div>
            </LiveExample>
        </Section>
    );
}

function ChoiceControlSection() {
    return (
        <Section
            id="choice-control"
            title="Choice control"
            tag="CANONICAL · ChoiceControl"
            kicker="A compact checkbox or radio whose whole label is the pointer target, for dense approval and permission lists."
        >
            <Guidance
                what={<>A native <code>input</code> of type <code>checkbox</code> or <code>radio</code> wrapped in its label. Extra props pass through to the input.</>}
                when={<>Use it inside extension approval screens where each row is one permission or account choice with a short inline label.</>}
                whenNot={<>Use <code>Checkbox</code> when a form field needs a description or error, and <code>RadioGroup</code> for a labelled set of exclusive options.</>}
                sizing={<>The painted box uses the control icon token and the label keeps the shared touch target on coarse pointers.</>}
                variants={<>Checkbox or radio, checked, unchecked and disabled, in both themes.</>}
                doRule={<>Keep the label short and specific to the permission it grants.</>}
                dontRule={<>Do not hand-roll a label around a raw input when this control fits.</>}
            />
            <Markup>
{`<ChoiceControl checked={remember} onChange={(event) => setRemember(event.target.checked)}>
    Remember this site
</ChoiceControl>
<ChoiceControl type="radio" name="account" value="main">Main account</ChoiceControl>`}
            </Markup>
            <LiveExample label="Checkbox, radio, and disabled states">
                <div style={{ display: 'grid', gap: 'var(--xc-space-2)' }}>
                    <ChoiceControl defaultChecked>Remember this site</ChoiceControl>
                    <ChoiceControl type="radio" name="sg-choice-account" value="main" defaultChecked>Main account</ChoiceControl>
                    <ChoiceControl disabled>Managed by your organization</ChoiceControl>
                </div>
            </LiveExample>
        </Section>
    );
}

export function StyleGuidePage() {
    const [view, setView] = useViewState();
    return (
        <ViewContext.Provider value={view}>
        <main className="sg-page">
            <h1 className="sg-h1">📐 XChain Wallet Component Style Guide</h1>
            <p className="sg-lead">
                The single source of truth for the wallet's reusable component vocabulary.
                When adding a new screen or changing an existing one, reach for the
                components catalogued here before rolling new markup. If you find yourself
                copying JSX between two routes, lift it into a shared component and add a
                section here.
            </p>
            <div className="sg-flag">
                <strong>How to read each section:</strong> a <em>guidance block</em> (what it
                is · when / when-not to use · sizing &amp; spacing · variants · do/don't),
                then the canonical JSX, then a live rendered example you can interact with.
                Examples render the actual component from
                {' '}<code>@xchain-wallet/core/ui</code>: what you see here is what you get
                in the app.
                {' '}Every example renders in a frame of the width picked in the bar
                below (Mobile 360px, Extension popup 400px, Desktop 1024px); the page
                templates also show all three side by side.
            </div>
            <div className="sg-sticky">
                <div className="sg-view-switch" role="group" aria-label="Preview width">
                    {Object.values(VIEWS).map((v) => (
                        <button
                            key={v.id}
                            type="button"
                            aria-pressed={view === v.id}
                            onClick={() => setView(v.id)}
                        >
                            {v.label} <span className="sg-view-width">{v.width}px</span>
                        </button>
                    ))}
                </div>
                <label className="sg-jump">
                    <span>Section</span>
                    <select
                        value=""
                        onChange={(e) => {
                            if (e.target.value) window.location.hash = e.target.value;
                        }}
                    >
                        <option value="">Jump to…</option>
                        {SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                </label>
            </div>
            <nav className="sg-toc" aria-label="Table of contents">
                {SECTIONS.map((s, i) => (
                    <span key={s.id}>
                        <a href={`#${s.id}`}>{s.label}</a>
                        {i < SECTIONS.length - 1 ? ' · ' : ''}
                    </span>
                ))}
            </nav>
            {SECTIONS.map(({ id, Component }) => (
                <Component key={id} />
            ))}
        </main>
        </ViewContext.Provider>
    );
}
// Reusable doc-chrome wrappers: each Section composes a heading,
// guidance block, canonical markup, and one or more live examples.
// Sections import these so the catalog has a consistent voice.

export function Section({ id, title, tag, kicker, children }) {
    const primitives = SECTIONS.find((section) => section.id === id)?.primitives || [];
    return (
        <section id={id} className="sg-section">
            <h2>
                {title}
                {tag ? <span className="sg-h2-tag">({tag})</span> : null}
            </h2>
            {kicker ? <p className="sg-kicker">{kicker}</p> : null}
            {children}
            {primitives.map((name) => <ComponentStateMatrix key={name} name={name} />)}
        </section>
    );
}

const PAGE_TEMPLATE_USAGE = Object.freeze({
    when: <>Use it inside the template that matches the screen: <code>FormPage</code> for input and submission, <code>ListPage</code> for browsing and read-only content.</>,
    whenNot: <>Do not add a route-specific card or width wrapper; the page template owns the responsive layout.</>,
    doRule: <>Keep forms bare below 600px and carded above it; let lists fill the content width to the scrollbar.</>,
    dontRule: <>Do not box a list into the 560px form column or choose the layout in JavaScript.</>,
});

export const TEMPLATE_VIEWS = Object.freeze([
    { id: 'compact', label: 'Compact', width: 360, note: '12px gutter' },
    { id: 'rail', label: 'Rail', width: 768, note: '12px gutter' },
    { id: 'full', label: 'Full', width: 1024, note: '12px gutter' },
]);

export function Guidance({
    what,
    when = PAGE_TEMPLATE_USAGE.when,
    whenNot = PAGE_TEMPLATE_USAGE.whenNot,
    sizing,
    variants,
    doRule = PAGE_TEMPLATE_USAGE.doRule,
    dontRule = PAGE_TEMPLATE_USAGE.dontRule,
    supersedes,
}) {
    return (
        <div className="sg-guide">
            <dl>
                {what ? (<><dt>What</dt><dd>{what}</dd></>) : null}
                {when ? (<><dt>When</dt><dd>{when}</dd></>) : null}
                {whenNot ? (<><dt>When not</dt><dd>{whenNot}</dd></>) : null}
                {sizing ? (<><dt>Sizing</dt><dd>{sizing}</dd></>) : null}
                {variants ? (<><dt>Variants</dt><dd>{variants}</dd></>) : null}
                {doRule ? (<><dt className="do">Do</dt><dd>{doRule}</dd></>) : null}
                {dontRule ? (<><dt className="dont">Don't</dt><dd>{dontRule}</dd></>) : null}
            </dl>
            {supersedes ? (
                <div className="sg-supersedes">
                    <strong>Canonical, supersedes:</strong> {supersedes}
                </div>
            ) : null}
        </div>
    );
}

export function Markup({ children }) {
    return (
        <div className="sg-markup">
            <pre><code>{children}</code></pre>
        </div>
    );
}

/**
 * A live example, rendered inside a frame at the width of the view picked in
 * the page's Mobile / Extension / Desktop switch.
 *
 * @param {object} props
 * @param {string} [props.label]
 * @param {number} [props.minHeight]   floor for overlay-only content (dialogs)
 * @param {boolean} [props.padded]     default true; false for an example that is a whole Screen
 * @param {import('react').ReactNode} props.children
 */
export function LiveExample({ label, minHeight, padded = true, children }) {
    return (
        <div className="sg-example">
            {label ? <p className="sg-example-label">{label}</p> : null}
            <ViewFrame title={label} minHeight={minHeight} padded={padded}>{children}</ViewFrame>
        </div>
    );
}

export function RadioGroupSection() {
    const [delivery, setDelivery] = useState('private');

    return (
        <Section
            id="radio-group"
            title="Radio group"
            tag="CANONICAL expanded exclusive choice"
            kicker="A labelled set of mutually exclusive choices that preserves native radio keyboard behavior."
        >
            <Guidance
                what={<>A native <code>fieldset</code> and <code>legend</code> containing same-name radio inputs, label-wide touch targets, and optional descriptions.</>}
                when={<>Use when every choice should remain visible and supporting copy helps users compare the options.</>}
                whenNot={<>Use <a href="#segmented-control">SegmentedControl</a> for two or three compact choices with short labels, or checkboxes when more than one value may be selected.</>}
                sizing={<>The circle uses <code>--xc-control-icon-md</code>. Every label provides a 44px minimum touch target without enlarging the circle.</>}
                variants={<>Option descriptions, disabled options or groups, required state, hint text, and error text.</>}
                doRule={<>Give the group a concise legend, pass one stable value, and let the native inputs provide arrow-key movement.</>}
                dontRule={<>Do not add route-local keyboard handlers, omit the legend, or use radio buttons for independent on/off settings.</>}
                supersedes={<>Route-local radio markup for expanded exclusive choices. Use <code>&lt;RadioGroup&gt;</code> from <code>@xchain-wallet/core/ui</code>.</>}
            />
            <Markup>
{`<RadioGroup
    legend="Delivery visibility"
    name="delivery"
    value={delivery}
    onChange={setDelivery}
    options={[
        { value: 'private', label: 'Private', description: 'Only the recipient can read it' },
        { value: 'public', label: 'Public', description: 'Readable by anyone' },
    ]}
/>`}
            </Markup>
            <LiveExample label="Delivery visibility">
                <RadioGroup
                    legend="Delivery visibility"
                    name="style-guide-delivery"
                    value={delivery}
                    onChange={setDelivery}
                    options={[
                        {
                            value: 'private',
                            label: 'Private',
                            description: 'Only the recipient can read it.',
                        },
                        {
                            value: 'public',
                            label: 'Public',
                            description: 'Stored as readable network data.',
                        },
                        {
                            value: 'scheduled',
                            label: 'Scheduled release',
                            description: 'Unavailable for this message type.',
                            disabled: true,
                        },
                    ]}
                />
            </LiveExample>
        </Section>
    );
}

export function SegmentedControlSection() {
    const [grouping, setGrouping] = useState('grouped');
    const [side, setSide] = useState('buy');

    return (
        <Section
            id="segmented-control"
            title="Segmented control"
            tag="CANONICAL compact exclusive choice"
            kicker="A two- or three-way choice with one selected value, a shared control height, and radio keyboard behavior."
        >
            <Guidance
                what={<>A <code>radiogroup</code> containing equal-width radio buttons. One segment is selected and reachable in the tab order; arrow keys, Home, and End both move focus and select a value.</>}
                when={<>Use for two or three short, mutually exclusive choices such as Grouped / Flat history or Buy / Sell order side.</>}
                whenNot={<>Use <a href="#tabs">Tabs</a> when the choice changes a page panel, checkboxes for multiple values, or a switch for an independent on/off setting.</>}
                sizing={<>The control uses <code>--xc-control-h-md</code>, <code>--xc-control-radius</code>, and equal-width segments. Apply a width through <code>className</code> when the control should fill its container.</>}
                doRule={<>✓ Provide an accessible label · keep labels short · keep exactly one selected value · use semantic success or danger tones only when the choices carry those meanings</>}
                dontRule={<>✗ Put unrelated actions in one control · wrap segments onto multiple lines · add custom heights or radii · implement route-local arrow-key handling</>}
                supersedes={<>Route-local native button groups for compact exclusive choices. Use <code>&lt;SegmentedControl&gt;</code> from <code>@xchain-wallet/core/ui</code>.</>}
            />

            <Markup>
{`<SegmentedControl
    aria-label="History grouping"
    value={grouping}
    onChange={setGrouping}
    items={[
        { id: 'grouped', label: 'Grouped' },
        { id: 'flat', label: 'Flat' },
    ]}
/>`}
            </Markup>

            <LiveExample label="History grouping">
                <SegmentedControl
                    aria-label="History grouping"
                    value={grouping}
                    onChange={setGrouping}
                    items={[
                        { id: 'grouped', label: 'Grouped' },
                        { id: 'flat', label: 'Flat' },
                    ]}
                />
            </LiveExample>

            <LiveExample label="Semantic order side">
                <SegmentedControl
                    aria-label="Order side"
                    value={side}
                    onChange={setSide}
                    items={[
                        { id: 'buy', label: 'Buy', tone: 'success' },
                        { id: 'sell', label: 'Sell', tone: 'danger' },
                    ]}
                />
            </LiveExample>
        </Section>
    );
}

/**
 * A page-template example at compact, rail, and full widths side by side;
 * the caller renders one Screen per frame.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {() => import('react').ReactNode} props.render
 * @param {number} [props.minHeight]
 */
export function TemplateExample({ label, render, minHeight }) {
    return (
        <div className="sg-example sg-example-wide">
            <p className="sg-example-label">{label} · compact / rail / full</p>
            <div className="sg-triptych">
                {TEMPLATE_VIEWS.map((view) => (
                    <figure key={view.id} className="sg-triptych-cell">
                        <figcaption className="sg-frame-label">
                            {view.label} · {view.width}px · {view.note}
                        </figcaption>
                        <ViewportFrame
                            width={view.width}
                            minHeight={minHeight}
                            padded={false}
                            title={`${label}, ${view.label} ${view.width}px`}
                        >
                            {render(view)}
                        </ViewportFrame>
                    </figure>
                ))}
            </div>
        </div>
    );
}
