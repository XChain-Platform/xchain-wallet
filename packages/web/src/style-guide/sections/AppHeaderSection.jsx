// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useState } from 'react';
import { AppHeader } from '@xchain-wallet/core/shared/components/AppHeader.jsx';
import { registry as registryLib } from '@xchain-wallet/core';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const chainRegistry = registryLib.defaultRegistry();
const COIN_FAMILIES = ['bitcoin', 'litecoin', 'dogecoin'];

export function AppHeaderSection() {
    const [networkFilter, setNetworkFilter] = useState('all');
    const [tokenQuery, setTokenQuery] = useState('');
    return (
        <Section
            id="app-header"
            title="App header"
            tag="CANONICAL persistent top bar"
            kicker="The wallet's global top strip. XChain logo anchors the left; up to four action buttons sit on the right (network filter, QR scan, lock, and the pancake menu). Stays mounted across every unlocked route so the brand and primary affordances never disappear."
        >
            <Guidance
                what={<>A flex row with the logo (58px wide, aspect-ratio preserved) on the left and a stack of right-side action buttons. Background is <code>--xc-surface</code> with a bottom hairline. Each right-side button is a 38×38 outlined square (1px <code>--xc-border-strong</code>, 8px radius); the uniform shape lets the user scan the strip without reading it.</>}
                when={<>Mounted by the layout wrapper (FullLayoutWithNav), never by individual routes. Stays visible on every unlocked screen. Route screens render the secondary toolbar (<code>PageHeader</code>) below it; the AppHeader is the higher-order chrome.</>}
                whenNot={<>Locked / onboarding / wizard flows that need full-screen focus; those use minimal or custom chrome. Modal overlays don't include it.</>}
                sizing={<>Bar: <code>padding: var(--xc-space-2) var(--xc-space-3)</code> (8/12px). Logo: 58px wide, auto height (preserves the 1.617:1 aspect from <code>xchain-color-750.png</code>). Action buttons: 38×38 with <code>gap: var(--xc-space-2)</code> between. The bar's outer padding (<code>space-3</code>) is one notch less than Screen.header's (<code>space-4</code>); <code>PageHeader</code> cancels the delta with a negative margin so its back chevron aligns to the logo's left edge.</>}
                variants={<>Right-side action stack is opt-in per prop: <code>showNetworkFilter</code> toggles the network filter (hide on Send/Receive, where it doesn't apply). <code>onScan</code> adds the QR-scan button. <code>onLock</code> adds the one-tap lock. <code>onMenuOpen</code> renders the pancake menu (always last in the stack).</>}
                doRule={<>✓ Always lead with the logo on the left · always place the pancake menu last in the right stack · keep the right-side buttons as outlined 38×38 squares with single Lucide-SVG icons · only add an action button if it's truly always-relevant; anything route-scoped goes in <code>PageHeader</code>'s trailing slot</>}
                dontRule={<>✗ Replace the logo with text · stack secondary text labels under the icon buttons (the icon-only language is the brand pace) · paint a filled background on the action buttons (always outline) · mix glyph sizes (every button uses the wallet's 18×18 Icon default)</>}
                supersedes={<>Per-route <code>.headerPopup</code> / <code>.menuBtn</code> rules. Lives at <code>packages/core/src/shared/components/AppHeader.jsx</code>; mounted by <code>FullLayoutWithNav</code>.</>}
            />

            <Markup>
{`import { AppHeader } from '@xchain-wallet/core/shared/components/AppHeader';

<AppHeader
    chainRegistry={chainRegistry}
    coinFamilies={['bitcoin', 'litecoin', 'dogecoin']}
    networkFilter={networkFilter}
    onNetworkFilterChange={setNetworkFilter}
    onScan={openScan}
    onLock={lock}
    onMenuOpen={openMenu}
/>`}
            </Markup>

            <LiveExample label="Full bar: network filter · scan · lock · menu">
                <div style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', overflow: 'hidden' }}>
                    <AppHeader
                        chainRegistry={chainRegistry}
                        coinFamilies={COIN_FAMILIES}
                        networkFilter={networkFilter}
                        onNetworkFilterChange={setNetworkFilter}
                        tokenQuery={tokenQuery}
                        onTokenQueryChange={setTokenQuery}
                        onScan={() => {}}
                        onLock={() => {}}
                        onMenuOpen={() => {}}
                    />
                </div>
            </LiveExample>

            <LiveExample label="Minimal bar: just the pancake menu (Send / Receive style)">
                <div style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', overflow: 'hidden' }}>
                    <AppHeader
                        showNetworkFilter={false}
                        onMenuOpen={() => {}}
                    />
                </div>
            </LiveExample>

            <LiveExample label="Without lock (wallet not yet unlocked / no lock action available)">
                <div style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', overflow: 'hidden' }}>
                    <AppHeader
                        chainRegistry={chainRegistry}
                        coinFamilies={COIN_FAMILIES}
                        networkFilter={networkFilter}
                        onNetworkFilterChange={setNetworkFilter}
                        onScan={() => {}}
                        onMenuOpen={() => {}}
                    />
                </div>
            </LiveExample>
        </Section>
    );
}
