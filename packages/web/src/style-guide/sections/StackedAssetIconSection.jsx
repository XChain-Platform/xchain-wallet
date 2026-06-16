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
import styles from './StackedAssetIconSection.module.css';

// Inline SVG placeholders so the live examples don't depend on a real
// chain registry / token image fetch. In-app, use
// `branding.chainIconLargeUrl(chainId)` / token `imageUrl` / `tickerColor`.
const BTC_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#F7931A"/><text x="32" y="44" text-anchor="middle" fill="white" font-family="Arial" font-weight="700" font-size="40">₿</text></svg>`,
);
const PEPE_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#5BA84A"/><circle cx="22" cy="26" r="7" fill="white"/><circle cx="42" cy="26" r="7" fill="white"/><circle cx="22" cy="26" r="3" fill="black"/><circle cx="42" cy="26" r="3" fill="black"/><path d="M16 42 Q32 52 48 42" stroke="black" stroke-width="3" fill="none"/></svg>`,
);

export function StackedAssetIconSection() {
    return (
        <Section
            id="stacked-asset-icon"
            title="Stacked asset icon"
            tag="CANONICAL token + chain visual"
            kicker="Round token image with a small chain pip overlaid in the bottom-right corner. Used wherever a token is shown next to its chain — balance rows, asset cards, asset heros, history entries."
        >
            <Guidance
                what={<>A 48×48 (or 40×40 in compact contexts) circular wrap with the token image inside. For non-native tokens, a 20×20 (or 18×18) chain pip overlays the bottom-right, sitting on a white-background ring so it reads against any underlying surface. Native rows skip the pip — the icon IS the chain.</>}
                when={<>Any row or hero that represents a held / receivable / sendable asset. BalanceList rows, Send asset hero, Receive asset card, history rows, contact rows with last-sent token.</>}
                sizing={<>Balance row: 48×48 wrap, 20×20 pip. Asset card row: 40×40 wrap, 18×18 pip. Asset hero (Send): 88×88 wrap, 28×28 pip. Pip is always anchored bottom + inset-inline-end with -2px offset so it sits at the corner without clipping.</>}
                doRule={<>✓ Use the published token image when available · fall back to a 1-letter chip tinted via <code>tickerColor(tick)</code> when not · always preserve the original art shape (don't crop to a square if the source is round / odd) · keep <code>object-fit: contain</code></>}
                dontRule={<>✗ Force <code>border-radius: 50%</code> on the token image — it crops square art into circles · drop the chain pip on non-native tokens (loses chain context) · resize the pip below 18px (illegible)</>}
                supersedes={<>Inline icon-rendering logic across BalanceList, Receive, Send, History. Source of truth is <code>BalanceList.module.css</code> (<code>.iconWrap</code> / <code>.iconImg</code> / <code>.iconLetter</code> / <code>.chainOverlay</code>) + <code>BalanceList.jsx</code>'s <code>tickerColor</code> helper.</>}
            />

            <Markup>
{`<div className={styles.iconWrap}>
    {row.imageUrl ? (
        <img src={row.imageUrl} className={styles.iconImg} alt="" />
    ) : (
        <span className={styles.iconLetter}
              style={{ background: tickerColor(row.tick), color: '#fff' }}>
            {row.tick[0]}
        </span>
    )}
    {!isNative && chainIconUrl ? (
        <img src={chainIconUrl} className={styles.chainOverlay} alt="" />
    ) : null}
</div>`}
            </Markup>

            <LiveExample label="Sizes and variants">
                <div className={styles.row}>
                    <div className={styles.demo}>
                        <div className={styles.iconWrap48}>
                            <img src={BTC_ICON} className={styles.iconImg48} alt="" />
                        </div>
                        <div className={styles.caption}>Native · 48px · no pip</div>
                    </div>
                    <div className={styles.demo}>
                        <div className={styles.iconWrap48}>
                            <img src={PEPE_ICON} className={styles.iconImg48} alt="" />
                            <img src={BTC_ICON} className={styles.chainOverlay20} alt="" />
                        </div>
                        <div className={styles.caption}>Token · 48px · 20px pip</div>
                    </div>
                    <div className={styles.demo}>
                        <div className={styles.iconWrap40}>
                            <img src={PEPE_ICON} className={styles.iconImg40} alt="" />
                            <img src={BTC_ICON} className={styles.chainOverlay18} alt="" />
                        </div>
                        <div className={styles.caption}>Token · 40px · 18px pip</div>
                    </div>
                    <div className={styles.demo}>
                        <div className={styles.iconWrap48}>
                            <span className={styles.iconLetter} style={{ background: '#A66CFF' }}>X</span>
                            <img src={BTC_ICON} className={styles.chainOverlay20} alt="" />
                        </div>
                        <div className={styles.caption}>Fallback letter chip</div>
                    </div>
                </div>
            </LiveExample>
        </Section>
    );
}
