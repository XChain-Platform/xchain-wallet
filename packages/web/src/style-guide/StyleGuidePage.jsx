// Canonical component style guide — the single source of truth for the
// wallet's reusable component vocabulary. Add a new <Section> for each
// component as it's documented. Sections render in the order declared
// in `SECTIONS` below; the TOC is generated from that list.
import { ColorPaletteSection } from './sections/ColorPaletteSection.jsx';
import { TypographySection } from './sections/TypographySection.jsx';
import { SpacingSection } from './sections/SpacingSection.jsx';
import { IconsSection } from './sections/IconsSection.jsx';
import { AppHeaderSection } from './sections/AppHeaderSection.jsx';
import { ScreenHeaderSection } from './sections/ScreenHeaderSection.jsx';
import { TabsSection } from './sections/TabsSection.jsx';
import { QuickActionSection } from './sections/QuickActionSection.jsx';
import { GrayCardSection } from './sections/GrayCardSection.jsx';
import { AccentBorderedCardSection } from './sections/AccentBorderedCardSection.jsx';
import { StackedAssetIconSection } from './sections/StackedAssetIconSection.jsx';
import { AssetHeroSection } from './sections/AssetHeroSection.jsx';
import { AssetCardSection } from './sections/AssetCardSection.jsx';
import { BalanceListSection } from './sections/BalanceListSection.jsx';
import { PillSegmentedSection } from './sections/PillSegmentedSection.jsx';
import { BigFieldSection } from './sections/BigFieldSection.jsx';
import { FeeSelectorSection } from './sections/FeeSelectorSection.jsx';
import { VoiceSection } from './sections/VoiceSection.jsx';
import { StatesSection } from './sections/StatesSection.jsx';
import { PrivacyModeSection } from './sections/PrivacyModeSection.jsx';

// Curated catalog — patterns we've established across the recent work
// (Home, Receive, Send, TokenDetail). Add a section here when a new
// pattern lands in two routes or you want to codify a one-off as
// canonical going forward.
const SECTIONS = [
    { id: 'color-palette',         label: 'Color palette',          Component: ColorPaletteSection },
    { id: 'typography',            label: 'Typography',             Component: TypographySection },
    { id: 'spacing',               label: 'Spacing & radii',        Component: SpacingSection },
    { id: 'icons',                 label: 'Icon catalog',           Component: IconsSection },
    { id: 'app-header',            label: 'App header',             Component: AppHeaderSection },
    { id: 'screen-header',         label: 'Screen header',          Component: ScreenHeaderSection },
    { id: 'tabs',                  label: 'Tabs (page-level)',      Component: TabsSection },
    { id: 'quick-action',          label: 'Quick-action card',      Component: QuickActionSection },
    { id: 'gray-card',             label: 'Gray surface card',      Component: GrayCardSection },
    { id: 'solid-accent-card',     label: 'Solid accent card',      Component: AccentBorderedCardSection },
    { id: 'stacked-asset-icon',    label: 'Stacked asset icon',     Component: StackedAssetIconSection },
    { id: 'asset-hero',            label: 'Asset hero (Send)',      Component: AssetHeroSection },
    { id: 'asset-card',            label: 'Asset card (Receive)',   Component: AssetCardSection },
    { id: 'balance-list',          label: 'Balance / search list',  Component: BalanceListSection },
    { id: 'pill-segmented',        label: 'Pill segmented',         Component: PillSegmentedSection },
    { id: 'big-field',             label: 'Big-field input',        Component: BigFieldSection },
    { id: 'fee-selector',          label: 'Fee selector',           Component: FeeSelectorSection },
    { id: 'voice',                 label: 'Voice & microcopy',      Component: VoiceSection },
    { id: 'states',                label: 'Loading / empty / error',Component: StatesSection },
    { id: 'privacy-mode',          label: 'Privacy mode',           Component: PrivacyModeSection },
];

export function StyleGuidePage() {
    return (
        <main className="sg-page">
            <h1 className="sg-h1">📐 XChain Wallet — Component Style Guide</h1>
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
                {' '}<code>@xchain-wallet/core/ui</code> — what you see here is what you get
                in the app.
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
    );
}

// Reusable doc-chrome wrappers — each Section composes a heading,
// guidance block, canonical markup, and one or more live examples.
// Sections import these so the catalog has a consistent voice.
export function Section({ id, title, tag, kicker, children }) {
    return (
        <section id={id} className="sg-section">
            <h2>
                {title}
                {tag ? <span className="sg-h2-tag">— {tag}</span> : null}
            </h2>
            {kicker ? <p className="sg-kicker">{kicker}</p> : null}
            {children}
        </section>
    );
}

export function Guidance({ what, when, whenNot, sizing, variants, doRule, dontRule, supersedes }) {
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
                    <strong>Canonical — supersedes:</strong> {supersedes}
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

export function LiveExample({ label, children }) {
    return (
        <div className="sg-example">
            {label ? <p className="sg-example-label">{label}</p> : null}
            {children}
        </div>
    );
}
