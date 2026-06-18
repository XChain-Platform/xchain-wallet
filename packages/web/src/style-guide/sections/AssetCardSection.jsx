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
import styles from './AssetCardSection.module.css';

const BTC_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#F7931A"/><text x="32" y="44" text-anchor="middle" fill="white" font-family="Arial" font-weight="700" font-size="40">₿</text></svg>`,
);
const PEPE_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#5BA84A"/><circle cx="22" cy="26" r="7" fill="white"/><circle cx="42" cy="26" r="7" fill="white"/><circle cx="22" cy="26" r="3" fill="black"/><circle cx="42" cy="26" r="3" fill="black"/><path d="M16 42 Q32 52 48 42" stroke="black" stroke-width="3" fill="none"/></svg>`,
);

export function AssetCardSection() {
    return (
        <Section
            id="asset-card"
            title="Asset card (Receive)"
            tag="horizontal, whole-card tap target"
            kicker="A gray card row with the asset icon on the left, name + secondary tick on the right, and a › chevron pinned to the far right. The entire card is the picker button; tap anywhere on it to navigate to the asset picker. Used on Receive."
        >
            <Guidance
                what={<>A gray-surface card laid out as <code>icon · text · chevron</code>. The whole card is a <code>&lt;button&gt;</code>; the chevron signals "this row is a picker". Pairs with the stacked asset icon pattern for the icon slot.</>}
                when={<>Bounded gray cards that represent a current selection within a vertical form (Receive's asset selector). Contrast with the asset hero, which is for screens where the asset is the page's lead and the icon stands alone in airy whitespace.</>}
                whenNot={<>If the card has no chevron and no other "tappable" signal, leave it as a plain gray card. If you want the row to be inert with an inline edit button, use the asset hero's icon-only pattern instead.</>}
                sizing={<>Card padding <code>var(--xc-space-3)</code> all around, 12px gap between icon and text, 40×40 icon wrap, chevron at 20px line-height. The chevron lives at the row's end and gets <code>flex: 0 0 auto</code> so the middle text can flex.</>}
                doRule={<>✓ Always include the chevron when the whole card is interactive (it's the discoverability anchor) · use the 40px stacked-icon variant (not the 48px row variant) so the row stays compact · keep the secondary line short (just the tick or network kind)</>}
                dontRule={<>✗ Use this without a chevron (then it reads as inert and users won't know to tap) · stack multiple of these vertically as a list (looks like a list of pickers; use BalanceList rows instead) · mix with the icon-only-tap pattern on the same screen (inconsistent affordance)</>}
                supersedes={<>The <code>.assetCard</code> row in Receive.module.css and its JSX in Receive.jsx. Lift to <code>&lt;AssetCard&gt;</code> in <code>@xchain-wallet/core/ui</code> once a second caller appears.</>}
            />

            <Markup>
{`<button type="button" className={styles.assetCard} onClick={onChangeAsset}>
    <span className={styles.iconWrap}>
        <img src={imageUrl} className={styles.icon} alt="" />
        {!isNative ? <img src={chainPipUrl} className={styles.chainPip} alt="" /> : null}
    </span>
    <span className={styles.text}>
        <span className={styles.name}>{name}</span>
        {isToken ? <span className={styles.sub}>{tick}</span> : null}
    </span>
    <span className={styles.chevron} aria-hidden="true">›</span>
</button>`}
            </Markup>

            <LiveExample label="Native: Bitcoin">
                <button type="button" className={styles.card} aria-label="Change asset (currently Bitcoin)">
                    <span className={styles.iconWrap}>
                        <img src={BTC_ICON} className={styles.icon} alt="" />
                    </span>
                    <span className={styles.text}>
                        <span className={styles.name}>Bitcoin</span>
                    </span>
                    <span className={styles.chevron} aria-hidden="true">›</span>
                </button>
            </LiveExample>

            <LiveExample label="Token: Pepe creature on Bitcoin">
                <button type="button" className={styles.card} aria-label="Change asset (currently Pepe creature)">
                    <span className={styles.iconWrap}>
                        <img src={PEPE_ICON} className={styles.icon} alt="" />
                        <img src={BTC_ICON} className={styles.chainPip} alt="" />
                    </span>
                    <span className={styles.text}>
                        <span className={styles.name}>Pepe creature</span>
                        <span className={styles.sub}>PEPECREATURE</span>
                    </span>
                    <span className={styles.chevron} aria-hidden="true">›</span>
                </button>
            </LiveExample>
        </Section>
    );
}
