// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { OfflineEmptyState } from '@xchain-wallet/core/shared/components/OfflineEmptyState.jsx';
import { BalancesUncheckedState } from '@xchain-wallet/core/shared/components/BalancesUncheckedState.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { PartsExampleProvider } from './partsExamples.jsx';

const noop = () => {};

export function UnavailableStatesSection() {
    return (
        <Section
            id="unavailable-states"
            title="Offline and unchecked states"
            tag="CANONICAL · OfflineEmptyState / BalancesUncheckedState"
            kicker="What an empty screen says when the cause is the connection, not the account: the page could not be loaded offline, or balances could not be checked."
        >
            <Guidance
                what={<>Both render the shared <code>EmptyState</code> with the info icon and a Try again action, and both hide the page-level reachability notice while shown so the message appears once. <code>BalancesUncheckedState</code> adds a Receive action when the screen offers one. <code>StalenessLabel</code> is a muted "updated N ago" line for stale price or balance data.</>}
                when={<>A list or detail that has nothing to show because the network is unreachable. Use <code>useBalancesUnchecked</code> to decide when a balance list is unchecked rather than empty.</>}
                whenNot={<>A reachable network with no data: that is the plain EmptyState.</>}
                doRule={<>✓ Pass <code>onRetry</code> so Try again re-runs the load</>}
                dontRule={<>✗ Say "no balances" when the check failed</>}
                supersedes={<>Source: <code>OfflineEmptyState.jsx</code>, <code>BalancesUncheckedState.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<OfflineEmptyState onRetry={reload} body="Reconnect to load this list." />
<BalancesUncheckedState onRetry={recheck} onReceive={openReceive} />`}
            </Markup>
            <LiveExample label="OfflineEmptyState">
                <PartsExampleProvider>
                    <OfflineEmptyState onRetry={noop} body="Reconnect to load this list." />
                </PartsExampleProvider>
            </LiveExample>
            <LiveExample label="BalancesUncheckedState">
                <PartsExampleProvider>
                    <BalancesUncheckedState onRetry={noop} onReceive={noop} />
                </PartsExampleProvider>
            </LiveExample>
        </Section>
    );
}
