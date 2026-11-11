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
            kicker="The wallet's global top strip. The logo and active wallet name anchor the left; lock, pop-out, and the wallet menu sit on the right."
        >
            <Guidance
                what={<>A single flex row with the logo, plain wallet name, and optional watch-only badge on the left. Lock appears where the sidebar does not provide it, Open in new window appears only on supported surfaces, and the pancake toggles the wallet menu.</>}
                when={<>Mounted by the layout wrapper, never by individual routes. It stays visible on every unlocked screen while route screens render <code>PageHeader</code> below it.</>}
                whenNot={<>Locked, onboarding, and wizard flows that need full-screen focus. Modal overlays do not include it.</>}
                sizing={<>Bar padding is <code>var(--xc-space-2) var(--xc-space-3)</code>. The logo is 58px wide and action buttons use the medium control tokens.</>}
                variants={<>The wallet label and Lock button are optional. The pancake is always present and reflects the shared wallet menu state with <code>aria-expanded</code>.</>}
                doRule={<>✓ Keep the pancake last · pass the command palette's open state and toggle function · keep every action as one outlined icon button</>}
                dontRule={<>✗ Add account, network, or wallet pickers to the header · add an unread dot · add a separate overflow menu</>}
                supersedes={<>The header settings popover and its action-row dropdown. Settings owns wallet, account, and network switching.</>}
            />

            <Markup>
{`<AppHeader
    activeWallet={{ id: walletId, name: 'Everyday wallet' }}
    onLock={lock}
    onPopOut={openInNewWindow}
    onMenuToggle={palette.togglePalette}
    menuOpen={palette.open}
/>`}
            </Markup>

            <LiveExample label="Wallet name, lock, pop-out, and menu">
                <div style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', overflow: 'hidden' }}>
                    <AppHeader
                        activeWallet={{ id: 'wallet-example', name: 'Everyday wallet' }}
                        onLock={() => {}}
                        onPopOut={() => {}}
                        onMenuToggle={() => {}}
                    />
                </div>
            </LiveExample>

            <LiveExample label="Open wallet menu">
                <div style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', overflow: 'hidden' }}>
                    <AppHeader
                        activeWallet={{ id: 'wallet-example', name: 'Everyday wallet' }}
                        onMenuToggle={() => {}}
                        menuOpen
                    />
                </div>
            </LiveExample>

            <LiveExample label="Watch-only wallet without lock">
                <div style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', overflow: 'hidden' }}>
                    <AppHeader
                        activeWallet={{ id: 'watch-wallet', name: 'Watch wallet' }}
                        isWatcherMode
                        onMenuToggle={() => {}}
                    />
                </div>
            </LiveExample>
        </Section>
    );
}
