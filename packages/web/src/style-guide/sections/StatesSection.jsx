// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { Skeleton, StatusMessage, Button, Icon } from '@xchain-wallet/core/ui';
import { EmptyStateNudge } from '@xchain-wallet/core/shared/components/EmptyStateNudge.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function StatesSection() {
    return (
        <Section
            id="states"
            title="Loading, empty, and error states"
            tag="GUIDANCE · pick the right one"
            kicker="Every fetch has four possible outcomes — fetching, loaded-with-content, loaded-empty, failed — plus the result-of-an-action: success or failure. We have a primitive for each. The rule below picks the right one so the wallet's never showing a spinner where it should show an empty state, or text where it should show a toast."
        >
            <Guidance
                what={<>Five primitives, each owning one slot in the state machine:
                    <ul style={{ margin: '8px 0 0 16px', padding: 0, lineHeight: 1.6 }}>
                        <li><strong><code>&lt;Skeleton&gt;</code></strong> — first paint while data is in flight; shapes mimic what's about to load.</li>
                        <li><strong><code>&lt;EmptyStateNudge&gt;</code></strong> — loaded successfully, dataset is empty; optional CTA to populate.</li>
                        <li><strong><code>&lt;StatusMessage variant="error"&gt;</code></strong> — inline, in the form, when a fetch or validation failed and the user needs to act in the same view.</li>
                        <li><strong><code>&lt;StatusMessage variant="status" | "success"&gt;</code></strong> — inline informational copy / confirmation after a successful action stays on the same view.</li>
                        <li><strong>Toast</strong> (via <code>ToastHost</code>) — ephemeral result of an action when the user has already moved on (e.g. copied to clipboard, address generated).</li>
                    </ul>
                </>}
                doRule={<>✓ Pick by intent, not aesthetic preference. Pre-fetch = Skeleton. Loaded-empty = EmptyStateNudge. Failed = inline StatusMessage. Action result = Toast (if non-blocking) or success StatusMessage (if blocking)</>}
                dontRule={<>✗ Show a spinner when you could show a skeleton (the skeleton conveys what's loading) · show empty-state text in a Skeleton-shaped slot (defeats the loading hint) · use a toast for an inline form error (the user can't act on a message that vanishes)</>}
            />

            <Markup>
{`// Pre-fetch — render a skeleton that matches the upcoming shape
{loading ? <Skeleton.List rows={5} /> : null}

// Loaded, nothing here — empty-state nudge with optional CTA
{!loading && rows.length === 0 ? (
    <EmptyStateNudge
        title="No balances yet"
        body="Generate an address to receive funds."
        actionLabel="Receive"
        onAction={openReceive}
        icon={<Icon.ReceiveIcon />}
    />
) : null}

// Inline error — user is still here, needs to act
<StatusMessage variant="error" recovery={
    <Button size="sm" onClick={useMax}>Use Max</Button>
}>
    Insufficient balance.
</StatusMessage>

// Action just completed, user has likely moved on — toast
showToast({ kind: 'success', message: 'Address copied to clipboard.' });`}
            </Markup>

            <LiveExample label="Skeleton — first paint, shape matches the data">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Skeleton shape="title" width="40%" />
                    <Skeleton shape="row" />
                    <Skeleton shape="row" />
                    <Skeleton shape="row" />
                </div>
            </LiveExample>

            <LiveExample label="EmptyStateNudge — loaded successfully, nothing yet">
                <EmptyStateNudge
                    title="No balances yet"
                    body="Generate a receive address to start funding your wallet."
                    actionLabel="Receive"
                    onAction={() => {}}
                    icon={<Icon.ReceiveIcon />}
                />
            </LiveExample>

            <LiveExample label="StatusMessage — inline error in a form">
                <StatusMessage variant="error">
                    Insufficient balance. You have 0.001 BTC available.
                </StatusMessage>
            </LiveExample>

            <LiveExample label="StatusMessage — inline success after action">
                <StatusMessage variant="success">
                    Address copied to clipboard.
                </StatusMessage>
            </LiveExample>

            <LiveExample label="StatusMessage — neutral status / informational">
                <StatusMessage variant="status">
                    Fee estimate refreshing…
                </StatusMessage>
            </LiveExample>
        </Section>
    );
}
