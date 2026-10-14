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
            title="Card"
            tag="CANONICAL grouping container · Card.module.css"
            kicker="The one card in the wallet: a solid 1px border in the border color, one corner radius, one inner padding and one fill. Every bordered content box composes it, so every card looks the same."
        >
            <Guidance
                what={<>A CSS module class in <code>packages/core/src/ui/Card.module.css</code>: <code>.card</code> draws <code>border: var(--xc-card-border)</code>, <code>border-radius: var(--xc-card-radius)</code>, <code>padding: var(--xc-card-pad)</code> and <code>background: var(--xc-card-bg)</code>. <code>.flush</code> is the same surface with no padding, for a list whose rows carry their own inset or a tile whose image runs to the edge. Route styles take it with <code>composes</code>; an inline style uses the four tokens.</>}
                when={<>Grouping a small cluster of related fields or values, a list of rows, a dashboard panel, an info block. Lists and dashboards fill the content width; the form template draws its own card from the same tokens, only on wide screens.</>}
                whenNot={<>Controls, menus, dialogs and toasts keep their own surfaces. Notices keep their tone color. An empty list shows the plain EmptyState, with no box.</>}
                sizing={<>Padding <code>--xc-card-pad</code>: 16px, 12px under 480px, 8px under 360px. Radius <code>--xc-card-radius</code> (8px). A card never sets its own border, radius, padding or fill (<code>test/unit/ui/cardSurfaces.test.js</code>).</>}
                doRule={<>✓ <code>composes: card from '../../ui/Card.module.css'</code> and keep only layout in the route rule · stack cards with the shared gaps</>}
                dontRule={<>✗ Dashed or dotted borders (a drop zone may show a dashed outline only while a file is dragged over it) · a different radius, padding or tint · a card inside a card (the inner one flattens automatically)</>}
                supersedes={<>Per-route bordered panels, boxed empty states and the gray card variants.</>}
            />

            <Markup>
{`<div className={styles.card}>
    {/* row content */}
</div>

// CSS:
.card {
    composes: card from '../../ui/Card.module.css';
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
