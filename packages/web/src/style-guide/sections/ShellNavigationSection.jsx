// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { LeftNav } from '@xchain-wallet/core/shared/components/LeftNav.jsx';
import { BottomTabBar } from '@xchain-wallet/core/shared/components/BottomTabBar.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { PartsExampleProvider } from './partsExamples.jsx';

const noop = () => {};

export function ShellNavigationSection() {
    const [view, setView] = useState('home');
    const frame = { border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', overflow: 'hidden', position: 'relative' };
    return (
        <Section
            id="shell-navigation"
            title="Navigation"
            tag="CANONICAL · shell"
            kicker="The shell uses a catalogue-backed left rail on wide layouts, a five-tab bar on phones, and the wallet menu for the complete destination list."
        >
            <Guidance
                what={<><code>LeftNav</code> and <code>BottomTabBar</code> read labels and icons from the wallet catalogue. The expanded side menu groups Wallet, Trade, Network, Build and Social destinations; its icon rail uses dividers between those groups. The tab bar exposes Home, Send, Receive, History and Settings.</>}
                when={<>Mounted once by the shell layout, never by a route.</>}
                whenNot={<>In-page navigation: Tabs and SegmentedControl.</>}
                doRule={<>✓ Remove a destination the build lacks instead of disabling it</>}
                dontRule={<>✗ Put Scan, Lists or Payments due in the side menu; they stay in the complete wallet menu. ✗ Put a Search row in the side menu; the header menu button and Cmd/Ctrl+K open the wallet menu and its search (U99)</>}
                supersedes={<>Source: <code>walletMenu.js</code>, <code>LeftNav.jsx</code> and <code>BottomTabBar.jsx</code> in <code>shared</code>.</>}
            />
            <Markup>
{`<LeftNav currentView={view} onSelect={setView} onLock={lock} onOpenSettings={openSettings} />
<BottomTabBar currentView={view} onSelect={setView} onOpenSettings={openSettings} isSignerMode={isSignerMode} />`}
            </Markup>
            <LiveExample label="LeftNav" minHeight={420} padded={false}>
                <PartsExampleProvider>
                    <div style={{ ...frame, width: 'max-content', maxWidth: '100%' }}>
                        <LeftNav currentView={view} onSelect={setView} onLock={noop} onOpenSettings={noop} />
                    </div>
                </PartsExampleProvider>
            </LiveExample>
            <LiveExample label="BottomTabBar" padded={false}>
                <PartsExampleProvider>
                    <div style={{ ...frame, height: 96 }}>
                        <BottomTabBar currentView={view} onSelect={setView} onOpenSettings={noop} />
                    </div>
                </PartsExampleProvider>
            </LiveExample>
        </Section>
    );
}
