// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import styles from './AssetHeroSection.module.css';

const BTC_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#F7931A"/><text x="32" y="44" text-anchor="middle" fill="white" font-family="Arial" font-weight="700" font-size="40">₿</text></svg>`,
);
const PEPE_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#5BA84A"/><circle cx="22" cy="26" r="7" fill="white"/><circle cx="42" cy="26" r="7" fill="white"/><circle cx="22" cy="26" r="3" fill="black"/><circle cx="42" cy="26" r="3" fill="black"/><path d="M16 42 Q32 52 48 42" stroke="black" stroke-width="3" fill="none"/></svg>`,
);

export function AssetHeroSection() {
    return (
        <Section
            id="asset-hero"
            title="Asset hero (Send)"
            tag="vertical, icon-only tap target"
            kicker="A large centered token icon over a bold name. The icon itself is the only tappable element; the surrounding whitespace stays inert so the user can rest their thumb anywhere without accidentally re-opening the picker. Used at the top of the Send form."
        >
            <Guidance
                what={<>An 88×88 icon (round wrap, raw published art with <code>object-fit: contain</code>) over a 20px bold display name. The icon wraps in a circular <code>&lt;button&gt;</code> when an <code>onChangeAsset</code> handler is provided; the name + outer container stay non-interactive.</>}
                when={<>The top of a form that operates on a single chosen asset (Send, future Stake / Bridge flows). Use this when the asset's visual identity is the page's lead: the user is here to do something WITH this asset.</>}
                whenNot={<>List screens that show multiple assets in rows → use the stacked asset icon at row-scale. Bounded gray cards with chevron affordance → use the horizontal asset card variant.</>}
                sizing={<>Icon wrap 88×88, name <code>--xc-text-xl</code> weight 700 with 4px top margin. Chain pip (non-native): 28×28, bottom-right of the icon. The button uses <code>filter: brightness(0.96)</code> on hover (no background fill; keeps the affordance round) and a circular focus ring <code>outline-offset: 4px</code>.</>}
                doRule={<>✓ Make ONLY the icon clickable · use the published token image (or letter-chip fallback) without forcing <code>border-radius: 50%</code> on the image itself · add the chain pip for non-native tokens · keep the name centered and short (truncate with ellipsis if it overflows)</>}
                dontRule={<>✗ Make the whole row a button (creates a navigation trap across the entire top of the form) · paint a background-fill on hover (rectangular hover under a round icon reads wrong) · use a filled circular crop on the image (loses original art shape)</>}
                supersedes={<>The <code>SelectedTokenHero</code> component in <code>Send.jsx</code>. Lift to a shared <code>&lt;AssetHero&gt;</code> in <code>@xchain-wallet/core/ui</code> when a second caller appears (Bridge, Stake, etc.).</>}
            />

            <Markup>
{`<div className={styles.heroWrap}>
    <button
        type="button"
        onClick={onChangeAsset}
        className={\`\${styles.heroIconWrap} \${styles.heroIconWrapInteractive}\`}
        aria-label={\`Change asset (currently \${name})\`}
    >
        <img src={imageUrl} className={styles.heroIcon} alt="" />
        {/* + optional chain pip overlay */}
    </button>
    <div className={styles.heroName}>{name}</div>
</div>`}
            </Markup>

            <LiveExample label="Native: Bitcoin (no chain pip)">
                <div className={styles.heroWrap}>
                    <button type="button" className={`${styles.iconWrap} ${styles.iconWrapInteractive}`} aria-label="Change asset (currently Bitcoin)">
                        <img src={BTC_ICON} className={styles.icon} alt="" />
                    </button>
                    <div className={styles.name}>Bitcoin</div>
                </div>
            </LiveExample>

            <LiveExample label="Token: Pepe creature on Bitcoin (with chain pip)">
                <div className={styles.heroWrap}>
                    <button type="button" className={`${styles.iconWrap} ${styles.iconWrapInteractive}`} aria-label="Change asset (currently Pepe creature)">
                        <img src={PEPE_ICON} className={styles.icon} alt="" />
                        <img src={BTC_ICON} className={styles.chainPip} alt="" />
                    </button>
                    <div className={styles.name}>Pepe creature</div>
                </div>
            </LiveExample>
        </Section>
    );
}
