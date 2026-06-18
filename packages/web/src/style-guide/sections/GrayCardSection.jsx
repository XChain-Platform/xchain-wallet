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
import styles from './GrayCardSection.module.css';

export function GrayCardSection() {
    return (
        <Section
            id="gray-card"
            title="Gray surface card"
            tag="CANONICAL grouping container"
            kicker="The default visual container for grouping related content: a muted-gray background with a hairline border and medium radius. Used for the QR display, address row, asset card, and inline section panels (anywhere content needs to feel grouped without competing with the page chrome)."
        >
            <Guidance
                what={<>A simple block with <code>background: var(--xc-bg-muted)</code>, <code>border: 1px solid var(--xc-border)</code>, <code>border-radius: var(--xc-radius-md)</code>, padding usually <code>var(--xc-space-3)</code>. Sits flat on the page, no shadow.</>}
                when={<>Grouping a small cluster of related fields, the address + copy row on Receive, the multisig block on Receive, the QR box, the asset card. Multiple cards on a page stack vertically with their own margin-bottom.</>}
                whenNot={<>Top-level content surfaces use <code>--xc-surface</code> (white); the wallet's main card is on <code>--xc-surface</code>. The gray card is for content WITHIN that surface.</>}
                sizing={<>Default padding <code>var(--xc-space-3)</code> (12px). Address-row uses <code>var(--xc-space-2) var(--xc-space-3)</code> (tighter vertical). Asset card uses <code>var(--xc-space-3)</code> all around.</>}
                doRule={<>✓ Use this for any "grouped block of fields / display values" · stack multiple cards with margin-bottom for vertical rhythm · combine with the stacked asset icon when the card represents an asset</>}
                dontRule={<>✗ Add a drop shadow (defeats the flat look) · use a different background tint (consistency wins over micro-variation) · nest cards (gray-on-gray reads flat; pull the inner content out instead)</>}
                supersedes={<>The matching <code>.addressBox</code>, <code>.assetCard</code>, <code>.qrBox</code>, multisig <code>&lt;section&gt;</code> rules in Receive.module.css; ChainBalanceCard's gray sub-rows. Lift into a <code>Card</code> primitive in <code>@xchain-wallet/core/ui</code> when a fourth caller appears.</>}
            />

            <Markup>
{`<div className={styles.card}>
    {/* row content */}
</div>

// CSS:
.card {
    background: var(--xc-bg-muted);
    border: 1px solid var(--xc-border);
    border-radius: var(--xc-radius-md);
    padding: var(--xc-space-3);
}`}
            </Markup>

            <LiveExample label="Plain card with content">
                <div className={styles.card}>
                    <strong>Receive on</strong>
                    <div style={{ color: 'var(--xc-text-muted)', fontSize: 13, marginTop: 4 }}>
                        Bitcoin · bc1qxy2k…q3z3
                    </div>
                </div>
            </LiveExample>

            <LiveExample label="Stack of cards: vertical rhythm">
                <div className={styles.card}>QR code goes here</div>
                <div className={styles.card}>Address row · copy · share</div>
                <div className={styles.card}>Amount input</div>
            </LiveExample>
        </Section>
    );
}
