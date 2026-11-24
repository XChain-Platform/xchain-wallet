// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Icon } from '@xchain-wallet/core/ui';
import { QuickActionTile } from '@xchain-wallet/core/ui/QuickActionTile.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function QuickActionSection() {
    return (
        <Section
            id="quick-action"
            title="Quick-action tile"
            tag="PRIMITIVE, no screen uses it yet"
            kicker="The square quick-action tile (icon over label). No routed screen renders it at present; token detail lists actions in its Actions tab."
        >
            <Guidance
                what={<>A <code>QuickActionTile</code>: a secondary <code>Button</code> with the shared tile class and icon slot. The screen's row (token detail) is a grid that gives every tile the same width and height.</>}
                when={<>Reserved for a short grid of primary actions.</>}
                whenNot={<>One action: a plain Button. Toolbar actions: the PageHeader trailing slot.</>}
                doRule={<>✓ Pair every icon with a label · keep the tiles the same height</>}
                dontRule={<>✗ Mix icon styles in one row · draw a tile from a bare <code>button</code> or a screen's own class</>}
                supersedes={<>The <code>square</code> prop draws the outlined square for action grids. Source: <code>ui/QuickActionTile.jsx</code> and <code>ui/QuickActionTile.module.css</code>.</>}
            />
            <Markup>
{`<div className={styles.quickActions}>
    <QuickActionTile icon={<Icon.SendIcon />}>Send</QuickActionTile>
</div>`}
            </Markup>
            <LiveExample label="Home quick actions">
                <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(0, 5.5rem)', justifyContent: 'center', gap: 'var(--xc-space-2)' }}>
                    <QuickActionTile icon={<Icon.SendIcon />}>Send</QuickActionTile>
                    <QuickActionTile icon={<Icon.ReceiveIcon />}>Receive</QuickActionTile>
                    <QuickActionTile icon={<Icon.MarketIcon />}>Exchange</QuickActionTile>
                    <QuickActionTile icon={<Icon.MoreIcon />}>More actions</QuickActionTile>
                </div>
            </LiveExample>
        </Section>
    );
}
