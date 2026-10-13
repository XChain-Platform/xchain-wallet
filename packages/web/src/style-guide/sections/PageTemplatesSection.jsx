// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Section, Guidance, Markup } from '../StyleGuidePage.jsx';

// Overview of the page templates; the sections after it show each one.
export function PageTemplatesSection() {
    return (
        <Section
            id="page-templates"
            title="Page templates"
            tag="RULE · every routed screen uses exactly one"
            kicker="Every routed screen is a Screen with a PageHeader, and its body is built from exactly one page template: FormPage for a screen you fill in and submit, ListPage for a screen that shows things. EmptyState and SectionHeader are the pieces those templates are made of. One rule on every platform: phone, extension popup, desktop app and browser."
        >
            <Guidance
                what={<>Two templates and two parts, all from <code>@xchain-wallet/core/ui</code>:
                    <ul style={{ margin: '8px 0 0 16px', padding: 0, lineHeight: 1.6 }}>
                        <li><strong><code>&lt;FormPage&gt;</code></strong>: the screen is a form. Narrow viewport (&lt; 600px): fields bare on the page gutter. Wide (&ge; 600px): one centred 560px card. The action row closes the form and wraps.</li>
                        <li><strong><code>&lt;FormSection&gt;</code></strong>: a titled part of a long form. Narrow: bare, divided by its heading. Wide, in <code>&lt;FormPage sectioned&gt;</code>: one card per section.</li>
                        <li><strong><code>&lt;ListPage&gt;</code></strong>: the screen shows things (list, table, card grid, read-only detail rows). Fills compact panes and centres at a 48rem maximum in wider panes; optional toolbar that wraps.</li>
                        <li><strong><code>&lt;EmptyState&gt;</code></strong>: the one empty state, centred: icon (optional), title, one line of body, optional action.</li>
                        <li><strong><code>&lt;SectionHeader&gt;</code></strong>: titles a group inside a page (an h2 by default).</li>
                    </ul>
                </>}
                when={<>Pick by what the screen is for. Fill in and submit: FormPage. Look at, pick from, or drill into: ListPage. A detail screen with an edit button is a ListPage; the edit screen it opens is a FormPage.</>}
                sizing={<>The breakpoint is a viewport media query at 600px, not a container query (the Android WebView 102 the app ships to has none) and not the shell: a phone browser gets the narrow form, a wide desktop window the card. The sidebar nav appears at 640px, so 600 to 639px is the bottom tab bar with a carded form.</>}
                doRule={<>✓ One template per screen · drop the <code>isFull ? styles.card : …</code> wrapper when converting, the template owns it · let the shared list measure handle pane widths</>}
                dontRule={<>✗ Decide card or bare in JS from the shell or a width check · box a list into the 560px form column · write a per-route empty-state block</>}
                supersedes={<>Per-route <code>.card</code> / <code>.listCard</code> / <code>.wrapFull</code> wrappers chosen by <code>screenVariantFor(shell)</code>, and <code>EmptyStateNudge</code>.</>}
            />
            <Markup>
{`import { Screen, PageHeader, FormPage, ListPage, EmptyState } from '@xchain-wallet/core/ui';

// A form screen
<Screen variant={variant} header={<PageHeader onBack={onBack} title="Verify signature" />}>
    <FormPage label="Verify signature" onSubmit={submit} actions={<Button type="submit">Verify</Button>}>
        ...fields
    </FormPage>
</Screen>

// A list screen
<Screen variant={variant} header={<PageHeader onBack={onBack} title="Payments due" />}>
    <ListPage toolbar={<input type="search" aria-label="Search payments" />}>
        {rows.length ? <ul>...</ul> : <EmptyState title="No payments due" body="..." />}
    </ListPage>
</Screen>`}
            </Markup>
        </Section>
    );
}
