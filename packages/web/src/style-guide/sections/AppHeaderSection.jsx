// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { AppHeader } from '@xchain-wallet/core/shared/components/AppHeader.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function AppHeaderSection() {
    return (
        <Section
            id="app-header"
            title="App header"
            tag="CANONICAL persistent top bar"
            kicker="The wallet's global top strip. The logo anchors the left; an optional Notifications bell and the wallet menu button sit on the right."
        >
            <Guidance
                what={<>A single flex row. The logo is on the left. On the right an optional Notifications bell shows an unread count bubble (blue for ordinary items, red when one needs action) beside the wallet menu button. There is no wallet name, badge or Lock in the bar. Props: <code>onMenuToggle</code>, <code>menuOpen</code>, <code>onNotifications</code>, <code>notificationsUnread</code>, <code>notificationsActionRequired</code>, <code>showMenu</code>.</>}
                when={<>Mounted by the layout wrapper, never by individual routes. It stays visible on every unlocked screen while route screens render <code>PageHeader</code> below it.</>}
                whenNot={<>Locked, onboarding, and wizard flows that need full-screen focus. Modal overlays do not include it. Boot and approval pages pass <code>showMenu={false}</code>.</>}
                sizing={<>Padding is the page gutter (8px, 2px less above, below and at the end). The logo is 58px wide (44px on short landscape screens). Buttons are 44px.</>}
                variants={<>The Notifications bell appears only when <code>onNotifications</code> is passed. <code>showMenu={false}</code> hides the menu on boot and approval pages.</>}
                doRule={<>✓ Keep the pancake last · pass the command palette's open state and toggle function · keep every action as one outlined icon button</>}
                dontRule={<>✗ Add account, network, or wallet pickers to the header · add a separate overflow menu</>}
                supersedes={<>The header settings popover and its action-row dropdown. Settings owns wallet, account, and network switching.</>}
            />

            <Markup>
{`<AppHeader onMenuToggle={toggleMenu} menuOpen={open} onNotifications={openAlerts} notificationsUnread={3} />`}
            </Markup>

            <LiveExample label="Logo and menu">
                <div style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', overflow: 'hidden' }}>
                    <AppHeader onMenuToggle={() => {}} />
                </div>
            </LiveExample>

            <LiveExample label="Bell with unread count">
                <div style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', overflow: 'hidden' }}>
                    <AppHeader onMenuToggle={() => {}} onNotifications={() => {}} notificationsUnread={3} />
                </div>
            </LiveExample>

            <LiveExample label="Bell needing action">
                <div style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', overflow: 'hidden' }}>
                    <AppHeader onMenuToggle={() => {}} onNotifications={() => {}} notificationsUnread={3} notificationsActionRequired={1} />
                </div>
            </LiveExample>

            <LiveExample label="Menu open">
                <div style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', overflow: 'hidden' }}>
                    <AppHeader onMenuToggle={() => {}} menuOpen />
                </div>
            </LiveExample>

            <LiveExample label="Menu hidden (showMenu={false})">
                <div style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', overflow: 'hidden' }}>
                    <AppHeader showMenu={false} />
                </div>
            </LiveExample>
        </Section>
    );
}
