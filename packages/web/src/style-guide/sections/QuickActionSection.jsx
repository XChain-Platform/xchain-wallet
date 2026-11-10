// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Icon } from '@xchain-wallet/core/ui';
import { QuickActionTile } from '@xchain-wallet/core/ui/QuickActionTile.jsx';
import homeStyles from '@xchain-wallet/core/shared/routes/Home.module.css';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function QuickActionSection() {
    return (
        <Section
            id="quick-action"
            title="Quick-action tile"
            tag="CANONICAL primary-CTA tile"
            kicker="The shared quick-action tile: a square with rounded corners, the icon centred and the label on its own line under it. Home and token detail draw their quick actions with this one component, so the example changes when they change."
        >
            <Guidance
                what={<>A <code>QuickActionTile</code>: a secondary <code>Button</code> with the shared tile class and icon slot. The screen's row (Home <code>.quickActions</code>) is a grid that gives every tile the same width and height.</>}
                when={<>A short row of primary actions at the top of a screen (Home and token detail: Send, Receive, Exchange, More).</>}
                whenNot={<>One action: a plain Button. Toolbar actions: the PageHeader trailing slot.</>}
                doRule={<>✓ Pair every icon with a label · keep the tiles the same height</>}
                dontRule={<>✗ Mix icon styles in one row · draw a tile from a bare <code>button</code> or a screen's own class</>}
                supersedes={<>The per-screen tile rules in <code>Home.module.css</code> and <code>TokenDetail.module.css</code>. Source: <code>ui/QuickActionTile.jsx</code> and <code>ui/QuickActionTile.module.css</code>.</>}
            />
            <Markup>
{`<div className={styles.quickActions}>
    <QuickActionTile icon={<Icon.SendIcon />}>Send</QuickActionTile>
</div>`}
            </Markup>
            <LiveExample label="Home quick actions">
                <div className={homeStyles.quickActions}>
                    <QuickActionTile icon={<Icon.SendIcon />}>Send</QuickActionTile>
                    <QuickActionTile icon={<Icon.ReceiveIcon />}>Receive</QuickActionTile>
                    <QuickActionTile icon={<Icon.MarketIcon />}>Exchange</QuickActionTile>
                    <QuickActionTile icon={<Icon.MoreIcon />}>More actions</QuickActionTile>
                </div>
            </LiveExample>
        </Section>
    );
}
