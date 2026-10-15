// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Icon, ListRow } from '@xchain-wallet/core/ui';
import { Guidance, LiveExample, Markup, Section } from '../StyleGuidePage.jsx';

export function ListRowSection() {
    return (
        <Section
            id="list-row"
            title="List row"
            tag="PRIMITIVE · ListRow"
            kicker="One consistent full-width row for navigation, actions, and read-only values."
        >
            <Guidance
                what={<>A row with <code>leading</code>, <code>title</code>, <code>subtitle</code>, <code>trailing</code>, and <code>chevron</code> slots. An <code>href</code> creates a link, an <code>onClick</code> handler creates a button, and neither creates a display-only div.</>}
                when={<>History, address, asset, staking, dispenser, and settings lists where each item follows the same reading order.</>}
                whenNot={<>Forms, multi-action cards, or table data that needs column headers.</>}
                sizing={<>Full width with minimum height <code>--xc-control-h-lg</code>. The containing Screen or ListPage owns <code>--xc-page-gutter</code>; the row adds only internal spacing.</>}
                variants={<>Native button, native link, and non-interactive div.</>}
                doRule={<>Use an <code>href</code> for navigation and <code>onClick</code> for an in-place action so keyboard behavior comes from the native element.</>}
                dontRule={<>Do not add <code>role="button"</code>, a manual tab index, or page-gutter padding to the row.</>}
            />
            <Markup>
{`<ListRow
    leading={<Icon.SendIcon />}
    title="Sent XCH"
    subtitle="Today at 10:42 AM"
    trailing="-12.50 XCH"
    chevron
    onClick={openTransaction}
/>`}
            </Markup>
            <LiveExample label="Button, link, and display-only rows">
                <ListRow
                    leading={<Icon.SendIcon />}
                    title="Sent XCH"
                    subtitle="Today at 10:42 AM"
                    trailing="-12.50 XCH"
                    chevron
                    onClick={() => {}}
                />
                <ListRow
                    leading={<Icon.ReceiveIcon />}
                    title="Open transaction"
                    subtitle="View details in this guide"
                    trailing="Confirmed"
                    chevron
                    href="#list-row"
                />
                <ListRow
                    title="Indexer status"
                    subtitle="Read-only information"
                    trailing="Synced"
                />
            </LiveExample>
        </Section>
    );
}
