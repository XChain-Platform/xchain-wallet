// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { BodyParagraph, WarningCard, WarningLine } from '@xchain-wallet/core/shared/components/WarningCard.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function WarningCardSection() {
    return (
        <Section
            id="warning-card"
            title="Warning card"
            tag="CANONICAL · WarningCard / WarningLine / BodyParagraph"
            kicker="The wallet's one look for a security warning: a padded card of plain lines, with the lines that protect the user's money as red Notices (a light red tint, a thin red border, no edge bar)."
        >
            <Guidance
                what={<><code>WarningCard</code> holds <code>WarningLine</code> rows; <code>critical</code> draws a line as a danger <code>Notice</code> (a thin wrapper); on a screen of its own, render <code>{'<Notice tone="danger" role="note">'}</code> outside the card instead, never a notice inside a card. <code>BodyParagraph</code> is the same start-aligned line at body size for an explanation page outside a card.</>}
                when={<>Explanatory pages of plain lines: license text, settings notes, the shortcut help footer. A money-protecting caution goes in a standalone danger Notice instead.</>}
                whenNot={<>A status after an action (Notice) or a field error (the form's error map).</>}
                doRule={<>✓ Keep each line one idea · mark only the money-protecting lines critical</>}
                dontRule={<>✗ Centre the text · colour a whole card red</>}
                supersedes={<>Source: <code>WarningCard.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<WarningCard>
    <WarningLine>Anyone with these words can take your funds.</WarningLine>
    <WarningLine critical>Never share them, and never type them into a website.</WarningLine>
</WarningCard>
<BodyParagraph>Write the words down in order and keep them offline.</BodyParagraph>`}
            </Markup>
            <LiveExample label="A card with plain and critical lines, then a body paragraph">
                <WarningCard>
                    <WarningLine>Anyone with these words can take your funds.</WarningLine>
                    <WarningLine critical>Never share them, and never type them into a website.</WarningLine>
                </WarningCard>
                <BodyParagraph>Write the words down in order and keep them offline.</BodyParagraph>
            </LiveExample>
        </Section>
    );
}
