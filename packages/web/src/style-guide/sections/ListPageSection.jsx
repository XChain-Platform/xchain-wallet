// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Section, Guidance, Markup, TemplateExample } from '../StyleGuidePage.jsx';
import { ExampleListScreen } from './templateExamples.jsx';

export function ListPageSection() {
    return (
        <Section
            id="list-page"
            title="List page"
            tag="TEMPLATE · ListPage"
            kicker="The template for every screen that shows things: lists, tables, card grids, read-only detail rows. Content fills compact and split-view layouts, then stays in a centred 48rem column so rows remain easy to scan."
        >
            <Guidance
                what={<>A fluid column with a readable maximum: optional <code>intro</code> line, optional <code>toolbar</code>, then the content (lists, SectionHeaders, an EmptyState). Props: <code>toolbar</code>, <code>intro</code>, <code>children</code>, plus any attribute for the root (<code>aria-label</code>).</>}
                when={<>Payments due, contacts, my tokens, dispensers, polls, history, a token or dispenser detail made of rows and cards, settings index pages.</>}
                whenNot={<>Anything the user fills in and submits (FormPage).</>}
                sizing={<>Width 100% of Screen's content box up to <code>48rem</code>, centred when the pane is wider. Screen reserves the scrollbar gutter (<code>scrollbar-gutter: stable</code>, and a styled bar on pointer devices), so content stops at the bar. Children are stacked <code>--xc-space-3</code> apart. Toolbar: the first item (usually search) takes the spare room, the rest keep their width and wrap below on a phone.</>}
                doRule={<>✓ Give a search box <code>type="search"</code> and an <code>aria-label</code> · title groups with SectionHeader · show EmptyState when the list is empty</>}
                dontRule={<>✗ Cap a list at the 560px form width · put a card around the whole list page · add a horizontal scroll to a list</>}
                supersedes={<>Route <code>.listCard</code>, <code>.wrapFull</code> / <code>.wrapPopup</code>, and lists placed inside the 560px form <code>.card</code>.</>}
            />
            <Markup>
{`<ListPage
    intro="Coin payments your matched DEX orders are waiting on."
    toolbar={<>
        <input type="search" aria-label="Search payments" ... />
        <select aria-label="Filter by chain">...</select>
        <Button size="sm" variant="secondary" onClick={refresh}>Refresh</Button>
    </>}
>
    <ul className={styles.list} aria-label="Pending payments">...</ul>
    <SectionHeader title="Expired, awaiting settlement" description="Do not pay these." />
    <ul className={styles.list} aria-label="Expired payments">...</ul>
</ListPage>`}
            </Markup>
            <TemplateExample label="ListPage: fluid to 48rem, toolbar wraps on the phone" render={() => <ExampleListScreen />} />
        </Section>
    );
}
