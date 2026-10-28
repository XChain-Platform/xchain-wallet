// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Icon } from '@xchain-wallet/core/ui';
import homeStyles from '@xchain-wallet/core/shared/routes/Home.module.css';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function QuickActionSection() {
    return (
        <Section
            id="quick-action"
            title="Quick-action tile"
            tag="CANONICAL primary-CTA tile"
            kicker="The Home action tile: a Button with a tinted round icon over a short label. The examples use the Home screen's own class names, so they change when Home changes."
        >
            <Guidance
                what={<>A <code>Button variant="secondary"</code> given the Home <code>.quickAction</code> class and an icon wrapped in <code>.quickActionIcon</code>. The row is <code>.quickActions</code>, a grid that gives every tile the same width and height.</>}
                when={<>A short row of primary actions at the top of a screen (Home: Send, Receive, Exchange).</>}
                whenNot={<>One action: a plain Button. Toolbar actions: the PageHeader trailing slot.</>}
                doRule={<>✓ Pair every icon with a label · keep the tiles the same height</>}
                dontRule={<>✗ Mix icon styles in one row · draw a tile from a bare <code>button</code></>}
                supersedes={<>The copy of the tile CSS this section used to hold. Source: <code>Home.jsx</code> and <code>Home.module.css</code>.</>}
            />
            <Markup>
{`<div className={styles.quickActions}>
    <Button variant="secondary" className={styles.quickAction}
        icon={<span className={styles.quickActionIcon}><Icon.SendIcon /></span>}>Send</Button>
</div>`}
            </Markup>
            <LiveExample label="Home quick actions">
                <div className={homeStyles.quickActions}>
                    <Button variant="secondary" className={homeStyles.quickAction} icon={<span className={homeStyles.quickActionIcon}><Icon.SendIcon /></span>}>Send</Button>
                    <Button variant="secondary" className={homeStyles.quickAction} icon={<span className={homeStyles.quickActionIcon}><Icon.ReceiveIcon /></span>}>Receive</Button>
                    <Button variant="secondary" className={homeStyles.quickAction} icon={<span className={homeStyles.quickActionIcon}><Icon.SwapIcon /></span>}>Exchange</Button>
                </div>
            </LiveExample>
        </Section>
    );
}
