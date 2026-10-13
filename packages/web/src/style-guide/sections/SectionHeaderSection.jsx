// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Button, SectionHeader } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function SectionHeaderSection() {
    return (
        <Section
            id="section-header"
            title="Section header"
            tag="TEMPLATE PART · SectionHeader"
            kicker="Titles one group inside a page: a run of list rows, a block of cards, a FormSection. A real heading element, so screen readers can jump between groups."
        >
            <Guidance
                what={<>Title (h2 by default, since the page title lives in PageHeader), optional one-line <code>description</code>, optional <code>trailing</code> action. Props: <code>title</code>, <code>as</code>, <code>id</code>, <code>description</code>, <code>trailing</code>.</>}
                when={<>Two or more groups on one ListPage (Payable / Expired; Pinned / All). FormSection uses it for its own heading.</>}
                whenNot={<>The page title (PageHeader) · a label for a single field (the field's own label).</>}
                sizing={<>Title <code>--xc-text-md</code> bold, description <code>--xc-text-sm</code> muted. The trailing action wraps below the title on a narrow screen instead of squeezing it.</>}
                doRule={<>✓ <code>as="h3"</code> for a group nested under another SectionHeader · one trailing action at most</>}
                dontRule={<>✗ Style a <code>&lt;p&gt;</code> to look like a heading · put the page title here</>}
            />
            <Markup>
{`<SectionHeader
    title="Expired, awaiting settlement"
    description="Do not pay these: the window has closed."
    trailing={<Button size="sm" variant="ghost" onClick={refresh}>Refresh</Button>}
/>`}
            </Markup>
            <LiveExample label="Title only">
                <SectionHeader title="Pinned" />
            </LiveExample>
            <LiveExample label="With description and trailing action">
                <SectionHeader
                    title="Expired, awaiting settlement"
                    description="Do not pay these: the window has closed."
                    trailing={<Button size="sm" variant="ghost" onClick={() => {}}>Refresh</Button>}
                />
            </LiveExample>
        </Section>
    );
}
