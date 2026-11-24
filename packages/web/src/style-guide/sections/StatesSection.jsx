// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Skeleton, Notice, NoticeList, Icon, EmptyState } from '@xchain-wallet/core/ui';
import { DiagnosticDetails } from '@xchain-wallet/core/shared/components/DiagnosticDetails.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function StatesSection() {
    return (
        <Section
            id="states"
            title="Loading, empty, and error states"
            tag="GUIDANCE · pick the right one"
            kicker="Every fetch has four possible outcomes (fetching, loaded-with-content, loaded-empty, failed) plus the result-of-an-action: success or failure. We have a primitive for each. The rule below picks the right one so the wallet's never showing a spinner where it should show an empty state, or text where it should show a toast."
        >
            <Guidance
                what={<>Five primitives, each owning one slot in the state machine:
                    <ul style={{ margin: '8px 0 0 16px', padding: 0, lineHeight: 1.6 }}>
                        <li><strong><code>&lt;Skeleton&gt;</code></strong>: first paint while data is in flight; shapes mimic what's about to load.</li>
                        <li><strong><code>&lt;EmptyState&gt;</code></strong>: loaded successfully, dataset is empty; optional CTA to populate (see the Empty state section; it supersedes <code>EmptyStateNudge</code>).</li>
                        <li><strong><code>&lt;Notice tone="danger"&gt;</code></strong>: inline, in the form, when a fetch or validation failed and the user needs to act in the same view.</li>
                        <li><strong><code>&lt;Notice tone="info" | "success"&gt;</code></strong>: inline informational copy, or confirmation after a successful action, on the same view.</li>
                        <li><strong>Toast</strong> (via <code>ToastHost</code>): ephemeral result of an action when the user has already moved on (e.g. copied to clipboard, address generated).</li>
                    </ul>
                    <code>StatusMessage</code> and its variant names are the older spelling of the same component. <code>PageNotice</code> draws a standard notice at the page's notice host when nested content raises it.
                </>}
                doRule={<>✓ Pick by intent, not aesthetic preference. Pre-fetch = Skeleton. Loaded-empty = EmptyState. Failed = inline Notice. Action result = Toast (if non-blocking) or success Notice (if blocking)</>}
                dontRule={<>✗ Show a spinner when you could show a skeleton (the skeleton conveys what's loading) · show empty-state text in a Skeleton-shaped slot (defeats the loading hint) · use a toast for an inline form error (the user can't act on a message that vanishes)</>}
            />

            <Markup>
{`// Pre-fetch: render a skeleton that matches the upcoming shape
{loading ? <Skeleton.List rows={5} /> : null}

// Loaded, nothing here: the one empty state, with optional CTA
{!loading && rows.length === 0 ? (
    <EmptyState
        title="No balances yet"
        body="Generate an address to receive funds."
        actionLabel="Receive"
        onAction={openReceive}
        actionIcon={<Icon.ReceiveIcon />}
    />
) : null}

// Inline error: user is still here, needs to act
<Notice tone="danger" details={technicalError} action={{ label: 'Use Max', onAction: useMax }}>
    Insufficient balance.
</Notice>

// Action just completed, user has likely moved on: toast. The host owns
// where it shows and how long it stays; pass only the words and the tone.
showToast({ variant: 'success', message: 'Address copied to clipboard.' });`}
            </Markup>

            <LiveExample label="Skeleton: first paint, shape matches the data">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                        <Skeleton shape="avatar" />
                        <Skeleton shape="title" width={120} />
                        <Skeleton shape="text" width={90} />
                        <Skeleton shape="badge" />
                    </div>
                    <Skeleton shape="row" />
                    <Skeleton shape="card" />
                    <Skeleton shape="tile" />
                    <Skeleton.Row />
                    <Skeleton.List rows={2} avatar={false} />
                </div>
            </LiveExample>

            <LiveExample label="EmptyState: loaded successfully, nothing yet">
                <EmptyState
                    title="No balances yet"
                    body="Generate a receive address to start funding your wallet."
                    actionLabel="Receive"
                    onAction={() => {}}
                    actionIcon={<Icon.ReceiveIcon />}
                />
            </LiveExample>

            <LiveExample label="Notice: danger with technical details and one-step action">
                <Notice
                    tone="danger"
                    details="available=0.001 BTC; required=0.0014 BTC"
                    action={{ label: 'Use Max', onAction: () => {} }}
                >
                    Insufficient balance. You have 0.001 BTC available.
                </Notice>
            </LiveExample>

            <LiveExample label="NoticeList: several issues are bullets inside the notice; one issue stays a plain line (U101)">
                <Notice tone="danger" title="Only partly checked">
                    <NoticeList
                        items={[
                            { key: 'list', content: 'The list this action names, which could not be read' },
                            { key: 'fee', content: 'The fee for how long this stays open' },
                        ]}
                    />
                </Notice>
            </LiveExample>

            <LiveExample label="DiagnosticDetails: collapsed technical context">
                <DiagnosticDetails
                    summary="Technical details"
                    items={['Explorer returned an invalid response.', 'Request can be retried safely.']}
                />
            </LiveExample>

            <LiveExample label="Notice: inline success after action">
                <Notice tone="success">
                    Address copied to clipboard.
                </Notice>
            </LiveExample>

            <LiveExample label="Notice: info (informational copy with its own tone)">
                <Notice tone="info">
                    Your balances update when the network reconnects.
                </Notice>
            </LiveExample>

            <Guidance
                what={<>Notice (the Notice Standard, G120): three tones, one look. A fill tinted in the tone, a thin border of the same tone, 8px corners, the tone icon, an optional bold <code>title</code>, the body, at most one <code>action</code> and an optional X (<code>onDismiss</code>). <code>tone</code> is <code>info</code>, <code>danger</code> (every warning, error and critical caution) or <code>success</code>. A toast takes the same tones and icons over the raised surface: its warning and error variants both paint danger.</>}
                when={<>Any message about the page or form the user is on.</>}
                whenNot={<>A field error (the field's own line under it) · a result the user has already moved on from (a toast).</>}
                doRule={<>✓ Use <code>role="note"</code> for a static critical caution · put the notice outside a card</>}
                dontRule={<>✗ A solid red fill · a coloured edge bar · a notice inside a card</>}
            />
            <Markup>
{`<Notice tone="info">Tokens you receive show here after one confirmation.</Notice>
<Notice tone="danger" action={{ label: 'Try again', onAction: retry }}>Couldn't send.</Notice>
<Notice tone="danger" role="note" title="Never share your recovery phrase">Anyone with these words can take everything.</Notice>
<Notice tone="info" title="Auto backup is on" onDismiss={hide}>An encrypted copy saves after each change.</Notice>
<Notice tone="success" title="Order placed">It stays under Open orders until it fills.</Notice>`}
            </Markup>
            <LiveExample label="Notice: one per tone, then a dismissible one">
                <Notice tone="info">Tokens you receive show here after one confirmation.</Notice>
                <Notice tone="danger" action={{ label: 'Try again', onAction: () => {} }}>
                    Couldn&apos;t send. The amount is more than this address holds.
                </Notice>
                <Notice tone="danger" role="note" title="Never share your recovery phrase">
                    Anyone with these words can take everything in this wallet.
                </Notice>
                <Notice tone="success" title="Order placed">
                    It stays under Open orders until it fills or expires.
                </Notice>
                <Notice tone="info" title="Auto backup is on" onDismiss={() => {}}>
                    An encrypted copy saves after each change.
                </Notice>
            </LiveExample>
        </Section>
    );
}
