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
import { ExampleSectionedFormScreen } from './templateExamples.jsx';

export function FormSectionSection() {
    return (
        <Section
            id="form-section"
            title="Form section"
            tag="TEMPLATE PART · FormSection"
            kicker="Splits a long form into titled parts. Inside <FormPage sectioned>: bare sections divided by their heading when narrow, a stack of section cards when wide, with the action row below the last card."
        >
            <Guidance
                what={<>A <code>&lt;section&gt;</code> named by its own heading (a SectionHeader, h2 by default), with an optional one-line <code>description</code>. Props: <code>title</code>, <code>description</code>, <code>headingLevel</code>, <code>children</code>.</>}
                when={<>A form with more than about six fields, or fields that fall into groups a user would name (Recipient, Amount, Fee; Token, Settings, Description).</>}
                whenNot={<>A short form: one card with no headings reads faster. A disclosure for advanced options that most users skip (use a <code>&lt;details&gt;</code> inside a section).</>}
                sizing={<>Narrow: sections stack with a 1px <code>--xc-border</code> rule and <code>--xc-space-4</code> above each heading after the first. Wide: each section is a 560px card, <code>--xc-space-4</code> apart.</>}
                doRule={<>✓ Set <code>sectioned</code> on the FormPage whenever its children are FormSections · keep section titles to one or two words</>}
                dontRule={<>✗ Use FormSection in a plain FormPage expecting cards (it stays bare there, so a card never nests in a card) · put the action row inside the last section</>}
            />
            <Markup>
{`<FormPage sectioned label="Issue token" onSubmit={submit} actions={<Button type="submit">Review</Button>}>
    <FormSection title="Token" description="The name and supply holders will see.">
        <Input label="Ticker" ... />
        <Input label="Supply" ... />
    </FormSection>
    <FormSection title="Settings">...</FormSection>
    <FormSection title="Description">...</FormSection>
</FormPage>`}
            </Markup>
            <TemplateExample label="Sectioned FormPage: heading-divided when narrow, section cards when wide" render={() => <ExampleSectionedFormScreen />} />
        </Section>
    );
}
