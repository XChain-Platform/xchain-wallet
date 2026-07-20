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
import styles from './TokenSelectorSection.module.css';

const BTC_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#F7931A"/><text x="32" y="44" text-anchor="middle" fill="white" font-family="Arial" font-weight="700" font-size="40">₿</text></svg>`,
);
const LTC_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#345D9D"/><text x="32" y="44" text-anchor="middle" fill="white" font-family="Arial" font-weight="700" font-size="40">Ł</text></svg>`,
);
const PEPE_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#5BA84A"/><circle cx="22" cy="26" r="7" fill="white"/><circle cx="42" cy="26" r="7" fill="white"/><circle cx="22" cy="26" r="3" fill="black"/><circle cx="42" cy="26" r="3" fill="black"/><path d="M16 42 Q32 52 48 42" stroke="black" stroke-width="3" fill="none"/></svg>`,
);

function Row({ imageUrl, chainPipUrl, name, sub, qty, fiat, letter, letterBg }) {
    return (
        <button type="button" className={styles.row}>
            <div className={styles.iconWrap}>
                {imageUrl ? (
                    <img src={imageUrl} alt="" className={styles.iconImg} />
                ) : (
                    <span className={styles.iconLetter} style={{ background: letterBg, color: '#fff' }}>
                        {letter}
                    </span>
                )}
                {chainPipUrl ? (
                    <img src={chainPipUrl} alt="" className={styles.chainOverlay} />
                ) : null}
            </div>
            <div className={styles.body}>
                <div className={styles.name}>{name}</div>
                <div className={styles.subtitle}>{sub}</div>
            </div>
            <div className={styles.amounts}>
                <div className={styles.qty}>{qty}</div>
                {fiat ? <div className={styles.fiat}>{fiat}</div> : null}
            </div>
        </button>
    );
}

export function TokenSelectorSection() {
    return (
        <Section
            id="token-selector"
            title="Token selector (Send / Receive picker)"
            tag="CANONICAL pick-an-asset page"
            kicker="The full-page 'pick a coin or token' pattern behind Send and Receive: an inline filter toolbar (free-text search + All/Coins/Tokens pill segments) docked directly above one balance-list card. Selecting a row hands {chainId, tick} to the host."
        >
            <Guidance
                what={<>A two-part stack: the filter toolbar (search field <code>flex: 1 1 160px</code> + pill segmented control, one row, never wraps) and the canonical balance-list card beneath it. The toolbar filters the card in place; there is no submit. Implemented once in <code>TokenPicker.jsx</code> and reused by Send, Receive, and the markets picker via the <code>purpose</code> prop.</>}
                when={<>Any screen whose only job is choosing one asset from everything the wallet can see. Send lists only spendable balances; Receive adds zero-balance chains and platform-wide token discovery. Keep the toolbar even for short lists so muscle memory holds.</>}
                whenNot={<>Inline pickers inside a form (use the asset card that opens this page) · lists where rows carry actions other than "select" (balances tab uses the same card but with pin/hide affordances) · filter needs beyond search + kind → this page's toolbar swaps the segments for a network dropdown (see the address list pattern).</>}
                sizing={<>Toolbar gap <code>--xc-space-2</code>, bottom margin <code>--xc-space-3</code>. Search: <code>--xc-text-sm</code>, padding <code>--xc-space-2 --xc-space-3</code>, <code>--xc-radius-md</code>, <code>--xc-border-strong</code>. Segments: 999px pill, active fill <code>--xc-accent-primary</code>. Card and rows: exactly the balance-list spec (48×48 icon, hairline dividers).</>}
                doRule={<>✓ Keep search and segments on ONE line (search shrinks, <code>min-width: 0</code>) · filter as the user types, no debounce spinner for local rows · preserve the user's filter when they back out and re-enter within a session (controlled-props mode) · show the empty-filter state inside the card, not a bare page</>}
                dontRule={<>✗ Add sort controls (the list is sorted chain-then-asset, pinned first, always) · turn segments into a dropdown when there are only 2-3 kinds · mix selector rows with action rows in one card</>}
                supersedes={<>The toolbar rules in <code>TokenPicker.module.css</code> (<code>.toolbar</code>/<code>.search</code>/<code>.kindSegments</code>) plus <code>BalanceList</code> for the card. The dispensers list reuses this page shape with a network dropdown in place of the segments.</>}
            />

            <Markup>
{`<TokenPicker
    purpose="send"
    walletId={walletId}
    accountId={accountId}
    title="Send"
    onBack={back}
    onSelect={({ chainId, tick }) => openSendForm(chainId, tick)}
/>`}
            </Markup>

            <LiveExample label="Toolbar (search + kind segments) docked above the balance card">
                <div className={styles.toolbar}>
                    <input type="text" className={styles.search} placeholder="Search" readOnly />
                    <div className={styles.kindSegments}>
                        <button type="button" className={`${styles.kindSegment} ${styles.kindSegmentActive}`}>All</button>
                        <button type="button" className={styles.kindSegment}>Coins</button>
                        <button type="button" className={styles.kindSegment}>Tokens</button>
                    </div>
                </div>
                <div className={styles.list}>
                    <Row imageUrl={BTC_ICON} name="Bitcoin" sub="BTC" qty="0.12345678" fiat="$11,728.30" />
                    <Row imageUrl={PEPE_ICON} chainPipUrl={BTC_ICON} name="Pepe creature" sub="PEPECREATURE" qty="1" fiat="$800.00" />
                    <Row letter="X" letterBg="#A66CFF" chainPipUrl={LTC_ICON} name="OmniLite Token" sub="OMNILITE" qty="42" fiat="$130.20" />
                    <Row imageUrl={LTC_ICON} name="Litecoin" sub="LTC" qty="5" fiat="$450.00" />
                </div>
            </LiveExample>
        </Section>
    );
}
