// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { EmptyState, Icon } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample, TemplateExample } from '../StyleGuidePage.jsx';
import { ExampleEmptyScreen } from './templateExamples.jsx';

export function EmptyStateSection() {
    return (
        <Section
            id="empty-state"
            title="Empty state"
            tag="TEMPLATE PART · EmptyState"
            kicker="The one empty state, used everywhere a list loaded fine and has nothing in it. Centred across the full content width: optional icon, a title, one line of body, an optional action that helps fill the view."
        >
            <Guidance
                what={<>Props: <code>title</code>, <code>body</code>, <code>icon</code> (decorative), <code>actionLabel</code> + <code>onAction</code> (the button shows only with both), <code>actionIcon</code>, <code>titleAs</code> (h2 default, h3 under a SectionHeader), <code>role</code> (default <code>status</code>, so a filter that empties the list is announced).</>}
                when={<>Loaded, nothing here: no payments due, no polls, no contacts, a search that matched nothing.</>}
                whenNot={<>Still loading (Skeleton) · the fetch failed (StatusMessage variant="error") · a form field with no value.</>}
                sizing={<>Full width, <code>--xc-space-6</code> top and bottom, dashed <code>--xc-border</code>. Body capped at 40 characters a line so it stays one or two short lines.</>}
                doRule={<>✓ Title says what is missing ("No payments due") · body says what would put something here · offer the action that does it</>}
                dontRule={<>✗ A bare "No X yet" paragraph · two paragraphs of explanation (link to help instead) · an action that leaves the screen for something unrelated</>}
                supersedes={<><code>EmptyStateNudge</code> (same props, minus <code>icon</code> and <code>titleAs</code>) and per-route <code>.empty</code> blocks.</>}
            />
            <Markup>
{`{rows.length === 0 ? (
    <EmptyState
        icon={<Icon.HandshakeIcon />}
        title="No polls yet"
        body="Create the first poll on this chain."
        actionLabel="Create poll"
        onAction={() => onCreate(chainId)}
    />
) : <ul>...</ul>}`}
            </Markup>
            <TemplateExample label="EmptyState in a ListPage: centred, full width at every size" render={() => <ExampleEmptyScreen />} />
            <LiveExample label="Title and body only">
                <EmptyState title="No payments due" body="Matched orders that need a coin payment appear here." />
            </LiveExample>
            <LiveExample label="With icon and action">
                <EmptyState
                    icon={<Icon.ReceiveIcon />}
                    title="No balances yet"
                    body="Generate a receive address to start funding your wallet."
                    actionLabel="Receive"
                    onAction={() => {}}
                />
            </LiveExample>
        </Section>
    );
}
