// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { registry as registryLib } from '@xchain-wallet/core';
import { Button, Icon, PageHeader, Select } from '@xchain-wallet/core/ui';
import { FileField } from '@xchain-wallet/core/shared/components/FileField.jsx';
import { ListFilterMenu } from '@xchain-wallet/core/shared/components/ListFilterMenu.jsx';
import { MnemonicGrid } from '@xchain-wallet/core/shared/components/MnemonicGrid.jsx';
import { PortfolioChart } from '@xchain-wallet/core/shared/components/PortfolioChart.jsx';
import { RouteErrorBoundary } from '@xchain-wallet/core/shared/components/RouteErrorBoundary.jsx';
import { Sparkline } from '@xchain-wallet/core/shared/components/Sparkline.jsx';
import { SwapTicket } from '@xchain-wallet/core/shared/components/marketTradeParts.jsx';
import { TileLookFields, TILE_COLOURS } from '@xchain-wallet/core/shared/components/TileLookFields.jsx';
import { WalletIdentity } from '@xchain-wallet/core/shared/components/WalletIdentity.jsx';
import { WalletModeField } from '@xchain-wallet/core/shared/components/WalletModeField.jsx';
import { BodyParagraph, WarningCard, WarningLine } from '@xchain-wallet/core/shared/components/WarningCard.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { SAMPLE_BALANCE_ROWS, SharedComponentExampleProvider } from './sharedComponentExamples.jsx';

const noop = () => {};
const chainRegistry = registryLib.defaultRegistry();
const COIN_FAMILIES = ['bitcoin', 'litecoin', 'dogecoin'];

// The public all-zero test phrase: it protects nothing, so the guide may show it.
const DEMO_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

export function FileFieldSection() {
    const [fileName, setFileName] = useState('');
    return (
        <Section
            id="file-field"
            title="File field"
            tag="CANONICAL · FileField"
            kicker="The one control for choosing a file: a field that shows the file's name, a choose button, a clear button and a drop target."
        >
            <Guidance
                what={<><code>FileField</code> wraps a hidden file input in the standard field anatomy (label, help, Optional tag, error). The host keeps the file; the field reports it through <code>onFile</code> and shows <code>fileName</code>.</>}
                when={<>Any form that takes a file: an image to publish, a backup to import, a PSBT to load.</>}
                whenNot={<>Pasting text (use Textarea) or scanning a code (the QR scanner).</>}
                doRule={<>✓ Pass <code>accept</code> as a default filter only · show the size limit in the label · pass <code>onClear</code> so the X appears once a file is picked</>}
                dontRule={<>✗ Render a raw file input · treat <code>accept</code> as validation</>}
                supersedes={<>Source: <code>FileField.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<FileField label="File (up to 7,792 bytes)" fileName={name} accept={['.png', '.jpg']}
    onFile={(file) => setName(file.name)} onClear={() => setName('')} />`}
            </Markup>
            <LiveExample label="Empty, then a picked file">
                <SharedComponentExampleProvider>
                    <FileField
                        label="File (up to 7,792 bytes)"
                        fileName={fileName}
                        onFile={(file) => setFileName(file.name)}
                        onClear={() => setFileName('')}
                    />
                    <FileField label="Backup" optional fileName="wallet-backup.json" onClear={noop} />
                </SharedComponentExampleProvider>
            </LiveExample>
        </Section>
    );
}

export function WarningCardSection() {
    return (
        <Section
            id="warning-card"
            title="Warning card"
            tag="CANONICAL · WarningCard / WarningLine / BodyParagraph"
            kicker="The wallet's one look for a security warning: a padded card of plain lines, with the lines that protect the user's money as red-edged callouts."
        >
            <Guidance
                what={<><code>WarningCard</code> holds <code>WarningLine</code> rows; <code>critical</code> draws a line as a red-edged callout. <code>BodyParagraph</code> is the same start-aligned line at body size for an explanation page outside a card.</>}
                when={<>Recovery phrase, private key and license screens, and any page whose text protects the user's money.</>}
                whenNot={<>A status after an action (StatusMessage) or a field error (FormNotice).</>}
                doRule={<>✓ Keep each line one idea · mark only the money-protecting lines critical</>}
                dontRule={<>✗ Centre the text · colour a whole card red</>}
                supersedes={<>Source: <code>WarningCard.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<WarningCard>
    <WarningLine>Anyone with these words can take your funds.</WarningLine>
    <WarningLine critical>Never share them, and never type them into a website.</WarningLine>
</WarningCard>
<BodyParagraph>Write the words down in order and keep them offline.</BodyParagraph>`}
            </Markup>
            <LiveExample label="A card with plain and critical lines, then a body paragraph">
                <WarningCard>
                    <WarningLine>Anyone with these words can take your funds.</WarningLine>
                    <WarningLine critical>Never share them, and never type them into a website.</WarningLine>
                </WarningCard>
                <BodyParagraph>Write the words down in order and keep them offline.</BodyParagraph>
            </LiveExample>
        </Section>
    );
}

export function WalletModeFieldSection() {
    const [mode, setMode] = useState('full');
    return (
        <Section
            id="wallet-mode-field"
            title="Wallet mode field"
            tag="CANONICAL · WalletModeField"
            kicker="The wallet-mode choice on the create and import forms: Normal, Watch-only or Air-gapped signer."
        >
            <Guidance
                what={<>A <code>RadioGroup</code> with an icon and a hint on each option, and a note that the choice is final. Wallet Details shows the mode read-only afterwards.</>}
                when={<>Creating or importing a wallet.</>}
                whenNot={<>Any screen after the wallet exists: the mode cannot change, so show it as text.</>}
                doRule={<>✓ Pass <code>disabled</code> while the form is busy</>}
                dontRule={<>✗ Offer a mode switch on an existing wallet</>}
                supersedes={<>Source: <code>WalletModeField.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<WalletModeField value={mode} onChange={setMode} />`}
            </Markup>
            <LiveExample label="Normal selected">
                <WalletModeField value={mode} onChange={setMode} name="sg-wallet-mode" />
            </LiveExample>
        </Section>
    );
}

export function ListFilterMenuSection() {
    const [query, setQuery] = useState('');
    const [network, setNetwork] = useState('all');
    const [status, setStatus] = useState('all');
    return (
        <Section
            id="list-filter-menu"
            title="List filter menu"
            tag="CANONICAL · ListFilterMenu"
            kicker="List pages keep search and filters in the title bar: one filter icon opens a panel, and a plus icon beside it creates a new item."
        >
            <Guidance
                what={<><code>ListFilterMenu</code> is a filter icon for a page header's <code>trailing</code> slot. Its panel holds the search box first, then the network picker (when given a registry and coin families), then the page's own pickers as children. A blue dot on the icon says a filter is narrowing the list.</>}
                when={<>A list page: contacts, dispensers, contracts, feeds. The page body is then only the list.</>}
                whenNot={<>A short list with nothing to narrow, and forms.</>}
                sizing={<>The icon and the plus icon are the same secondary icon button size, side by side in the title bar.</>}
                doRule={<>✓ Pass <code>active</code> when a child filter is off its default · put the New action beside it as a plain plus icon with an accessible name</>}
                dontRule={<>✗ Draw a search box or filter row in the page body · give the plus icon a visible text label</>}
                supersedes={<>Source: <code>ListFilterMenu.jsx</code> in <code>shared/components</code>. Reference page: <code>DispensersList.jsx</code>.</>}
            />
            <Markup>
{`<PageHeader onBack={back} title="My Dispensers" trailing={(
    <>
        <ListFilterMenu query={query} onQueryChange={setQuery} searchPlaceholder="Search" searchLabel="Search dispensers"
            active={status !== 'all'} label="Filter dispensers"
            chainRegistry={registry} coinFamilies={families} networkFilter={network} onNetworkFilterChange={setNetwork}>
            <Select label="Status" size="md" ...>...</Select>
        </ListFilterMenu>
        <Button variant="secondary" icon={<Icon.PlusIcon />} aria-label="New dispenser" title="New dispenser" onClick={create}>{null}</Button>
    </>
)} />`}
            </Markup>
            <LiveExample label="Title bar with the filter icon and the plus icon" padded={false}>
                <PageHeader
                    onBack={noop}
                    title="My Dispensers"
                    trailing={(
                        <>
                            <ListFilterMenu
                                query={query}
                                onQueryChange={setQuery}
                                active={status !== 'all'}
                                label="Filter dispensers"
                                searchPlaceholder="Search"
                                searchLabel="Search dispensers"
                                chainRegistry={chainRegistry}
                                coinFamilies={COIN_FAMILIES}
                                networkFilter={network}
                                onNetworkFilterChange={setNetwork}
                            >
                                <Select label="Status" size="md" value={status} onChange={(event) => setStatus(event.target.value)}>
                                    <option value="all">All</option>
                                    <option value="open">Open</option>
                                    <option value="soldout">Sold out</option>
                                </Select>
                            </ListFilterMenu>
                            <Button variant="secondary" icon={<Icon.PlusIcon />} aria-label="New dispenser" title="New dispenser" onClick={noop}>
                                {null}
                            </Button>
                        </>
                    )}
                />
            </LiveExample>
        </Section>
    );
}

export function PortfolioChartSection() {
    return (
        <Section
            id="portfolio-chart"
            title="Portfolio chart"
            tag="CANONICAL · PortfolioChart"
            kicker="Home's performance chart: the wallet's total fiat value over a chosen range, drawn on the brand card."
        >
            <Guidance
                what={<><code>PortfolioChart</code> sums each balance row's fiat value into one series for the selected range, with range tabs and a change readout. Its series always ends at the portfolio total, so it agrees with the balance hero.</>}
                when={<>Home, under the total balance.</>}
                whenNot={<>One token's price history (Sparkline).</>}
                doRule={<>✓ Pass rows already filtered by network · let the user hide it from settings</>}
                dontRule={<>✗ Fetch prices inside the chart's parent on every render</>}
                supersedes={<>Source: <code>PortfolioChart.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<PortfolioChart rows={rows} walletId={walletId} nativePriceMap={prices} onRangeChange={setRange} />`}
            </Markup>
            <LiveExample label="Three sample balances">
                <SharedComponentExampleProvider>
                    <PortfolioChart rows={SAMPLE_BALANCE_ROWS} walletId="wallet-example" />
                </SharedComponentExampleProvider>
            </LiveExample>
        </Section>
    );
}

const TREND_UP = [10, 11, 10.5, 12, 13, 12.5, 14, 15, 14.2, 16];
const TREND_DOWN = [16, 15, 15.5, 14, 13, 13.4, 12, 11, 11.6, 10];

export function SparklineSection() {
    return (
        <Section
            id="sparkline"
            title="Sparkline"
            tag="CANONICAL · Sparkline"
            kicker="A small price trend line for one token, drawn from a plain list of numbers."
        >
            <Guidance
                what={<><code>Sparkline</code> draws <code>series</code> as an SVG line with an optional area fill. It carries an accessible label and range description.</>}
                when={<>Token rows and token detail pages.</>}
                whenNot={<>The wallet total, which has range tabs (PortfolioChart).</>}
                sizing={<>Height 80 by default; <code>edgeToEdge</code> runs the line to both edges of its container.</>}
                doRule={<>✓ Pass <code>label</code> and <code>rangeLabel</code> so a screen reader hears the trend</>}
                dontRule={<>✗ Invent a series for a real wallet that has no history</>}
                supersedes={<>Source: <code>Sparkline.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<Sparkline series={prices} height={80} rangeLabel="Last 24 hours" />
<Sparkline series={prices} edgeToEdge />`}
            </Markup>
            <LiveExample label="Rising and falling series, then edge to edge">
                <Sparkline series={TREND_UP} rangeLabel="Last 24 hours" />
                <Sparkline series={TREND_DOWN} rangeLabel="Last 24 hours" />
                <Sparkline series={TREND_UP} edgeToEdge height={48} />
            </LiveExample>
        </Section>
    );
}

export function MnemonicGridSection() {
    return (
        <Section
            id="mnemonic-grid"
            title="Mnemonic grid"
            tag="CANONICAL · MnemonicGrid"
            kicker="The recovery phrase as numbered words, concealed until the user reveals it."
        >
            <Guidance
                what={<><code>MnemonicGrid</code> shows the words in a 2-column (<code>small</code>) or responsive 2/4-column (<code>full</code>) grid. It holds the screen guard while mounted and offers no copy button, because clipboard history can keep a phrase.</>}
                when={<>Showing or confirming a recovery phrase.</>}
                whenNot={<>Entering a phrase (the import form's inputs).</>}
                doRule={<>✓ Pair it with a WarningCard</>}
                dontRule={<>✗ Add a copy button · log or store the phrase</>}
                supersedes={<>Source: <code>MnemonicGrid.jsx</code> in <code>shared/components</code>. The example uses the public all-zero test phrase.</>}
            />
            <Markup>
{`<MnemonicGrid mnemonic={phrase} variant="small" />`}
            </Markup>
            <LiveExample label="Concealed, then revealed">
                <SharedComponentExampleProvider>
                    <MnemonicGrid mnemonic={DEMO_MNEMONIC} variant="small" />
                    <MnemonicGrid mnemonic={DEMO_MNEMONIC} variant="small" startRevealed />
                </SharedComponentExampleProvider>
            </LiveExample>
        </Section>
    );
}

const EXAMPLE_WALLET = Object.freeze({ id: 'wallet-example', name: 'Everyday wallet' });
const SECOND_WALLET = Object.freeze({ id: 'wallet-savings', name: 'Savings' });

export function WalletIdentitySection() {
    const [colour, setColour] = useState(TILE_COLOURS[1]);
    const [shape, setShape] = useState('circle');
    const [image, setImage] = useState(null);
    return (
        <Section
            id="wallet-identity"
            title="Wallet identity"
            tag="CANONICAL · WalletIdentity / TileLookFields"
            kicker="A wallet's avatar and name, in the colour and shape the user chose, with initials so it never relies on colour alone."
        >
            <Guidance
                what={<><code>WalletIdentity</code> shows the tile (colour, shape, image or initials) beside the name, in a <code>header</code>, <code>list</code> or <code>hero</code> context. <code>TileLookFields</code> is the colour, shape and image editor shared by Rename Wallet and Edit Account.</>}
                when={<>Wherever a wallet is named: the app header, the wallet list, a wallet detail hero.</>}
                whenNot={<>An account or address (use an AssetMark or the address text).</>}
                doRule={<>✓ Use it for every wallet name so a change of tile shows everywhere</>}
                dontRule={<>✗ Draw your own initials circle</>}
                supersedes={<>Source: <code>WalletIdentity.jsx</code>, <code>TileLookFields.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<WalletIdentity wallet={{ id, name }} context="list" />
<WalletIdentity wallet={wallet} namePrefix="Wallet: " active />
<TileLookFields kind="wallet" colour={c} onColour={setC} shape={s} onShape={setS} image={img} onImage={setImg} />`}
            </Markup>
            <LiveExample label="Header, list and active identities">
                <div style={{ display: 'grid', gap: 'var(--xc-space-3)' }}>
                    <WalletIdentity wallet={EXAMPLE_WALLET} context="header" namePrefix="" />
                    <WalletIdentity wallet={SECOND_WALLET} context="list" />
                    <WalletIdentity wallet={EXAMPLE_WALLET} context="list" active />
                </div>
            </LiveExample>
            <LiveExample label="TileLookFields">
                <SharedComponentExampleProvider>
                    <TileLookFields
                        kind="wallet"
                        colour={colour}
                        onColour={setColour}
                        shape={shape}
                        onShape={setShape}
                        image={image}
                        onImage={setImage}
                    />
                </SharedComponentExampleProvider>
            </LiveExample>
        </Section>
    );
}

export function MarketTradePartsSection() {
    const [side, setSide] = useState('buy');
    const [pay, setPay] = useState('0.01');
    const [get, setGet] = useState('2500');
    return (
        <Section
            id="market-trade-parts"
            title="Market trade parts"
            tag="CANONICAL · marketTradeParts"
            kicker="The pieces of the market trading panels: the swap ticket with its flip button, and the Buy and Sell glyphs."
        >
            <Guidance
                what={<><code>SwapTicket</code> shows a Pay field and a Get field for one pair with a flip between them; typing in one side fills the other, and leaving a field settles the typed side to its exact value. <code>BuyGlyph</code> and <code>SellGlyph</code> mark the two sides; <code>tidyQuotePrice</code> trims a quote to a readable price.</>}
                when={<>Market buy and sell panels, and any trade ticket that pays one asset to get another.</>}
                whenNot={<>Forms in the Give / Get standard, which have their own cards.</>}
                doRule={<>✓ Pass a balance line and a per-unit note under the Get field</>}
                dontRule={<>✗ Compute the other side with a rounded price: settle to the exact value on blur</>}
                supersedes={<>Source: <code>marketTradeParts.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<SwapTicket side="buy" chainId={chainId} payTick="BTC" getTick="PEPECASH" payValue={pay} getValue={get}
    onPayChange={setPay} onGetChange={setGet} onSettle={settle} payBalance="Balance 0.4821" getNote="at 0.000004 each" onFlip={flip} />`}
            </Markup>
            <LiveExample label="Buy ticket with a flip">
                <SharedComponentExampleProvider>
                    <SwapTicket
                        side={side}
                        chainId="bitcoin-mainnet"
                        payTick={side === 'buy' ? 'BTC' : 'PEPECASH'}
                        getTick={side === 'buy' ? 'PEPECASH' : 'BTC'}
                        payValue={pay}
                        getValue={get}
                        onPayChange={setPay}
                        onGetChange={setGet}
                        onSettle={noop}
                        payBalance="Balance 0.4821"
                        getNote="at 0.000004 each"
                        onFlip={() => setSide((s) => (s === 'buy' ? 'sell' : 'buy'))}
                    />
                </SharedComponentExampleProvider>
            </LiveExample>
        </Section>
    );
}

function Failing({ fail }) {
    if (fail) throw new Error('Example route failure');
    return <BodyParagraph>This route rendered normally.</BodyParagraph>;
}

export function RouteErrorBoundarySection() {
    const [fail, setFail] = useState(false);
    return (
        <Section
            id="route-error-boundary"
            title="Route error boundary"
            tag="CANONICAL · RouteErrorBoundary"
            kicker="What a failed route shows instead of a blank screen: a plain message with Try again and Home, with the session left unlocked."
        >
            <Guidance
                what={<><code>RouteErrorBoundary</code> catches a render failure in the route below it. Home changes only shell navigation, so providers and the unlocked session stay mounted; without shell navigation it reloads the entry point. When the failing route is Home, only Try again is offered. A new <code>resetKey</code> clears the failure.</>}
                when={<>Around the routed content of every shell.</>}
                whenNot={<>Expected errors (a refused request, a missing file): those are a form notice or a StatusMessage.</>}
                doRule={<>✓ Pass <code>resetKey</code> so moving to another route clears it</>}
                dontRule={<>✗ Wrap a single field · show the error text to the user</>}
                supersedes={<>Source: <code>RouteErrorBoundary.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<RouteErrorBoundary resetKey={route} onHome={goHome} atHome={route === 'home'}>
    {routeElement}
</RouteErrorBoundary>`}
            </Markup>
            <LiveExample label="A route that renders, then one that fails" minHeight={260}>
                <SharedComponentExampleProvider>
                    <RouteErrorBoundary resetKey={fail ? 'failed' : 'ok'} onHome={() => setFail(false)} onReload={() => setFail(false)}>
                        <Failing fail={fail} />
                    </RouteErrorBoundary>
                    {fail ? null : (
                        <Button variant="secondary" icon={<Icon.InfoIcon />} onClick={() => setFail(true)}>
                            Show a Failed Route
                        </Button>
                    )}
                </SharedComponentExampleProvider>
            </LiveExample>
        </Section>
    );
}
