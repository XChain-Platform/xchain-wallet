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
import { ExampleFormScreen } from './templateExamples.jsx';

export function FormPageSection() {
    return (
        <Section
            id="form-page"
            title="Form page"
            tag="TEMPLATE · FormPage"
            kicker="The template for every screen you fill in and submit. Same markup at every width; the stylesheet decides. Narrow (under 600px): the fields sit bare inside Screen's single page gutter. Wide (600px and up): the form sits in one centred 560px card."
        >
            <Guidance
                what={<>Renders the <code>&lt;form&gt;</code> itself: optional <code>intro</code> line, the fields, an optional <code>status</code> slot (a <code>StatusMessage</code>), then the <code>actions</code> row. Props: <code>onSubmit</code>, <code>actions</code>, <code>status</code>, <code>intro</code>, <code>sectioned</code>, <code>label</code> (accessible name, makes it a form landmark), <code>noValidate</code> (default true), <code>ref</code> to the form.</>}
                when={<>Send-style flows, rename / edit screens, every action form, sign and verify, settings sub-forms that submit.</>}
                whenNot={<>A screen that only shows things (use ListPage), a multi-step wizard's step chrome (each step's body can still be a FormPage).</>}
                sizing={<>Breakpoint 600px, viewport media query. <code>Screen.body</code> alone applies <code>--xc-page-gutter</code> and <code>--xc-page-top</code>; FormPage adds no outer inset. Wide card: one centred 560px column with <code>--xc-space-6</code> padding, <code>--xc-radius-lg</code>, and <code>--xc-surface-raised</code>. The action row wraps; each button grows, so a lone button is full width and two share the row. Put the primary action last so it lands on the right.</>}
                doRule={<>✓ Pass errors through <code>status</code> so they sit right above the button that retries · give the form a <code>label</code> · keep the submit inside <code>actions</code> (or in the PageHeader trailing slot for a one-field rename)</>}
                dontRule={<>✗ Wrap it in a route <code>.card</code> · choose card vs bare from <code>screenVariantFor(shell)</code> · put buttons in the middle of the fields</>}
            />
            <Markup>
{`<FormPage
    label="Verify signature"
    onSubmit={handleSubmit}
    intro="Check that a message was signed by the owner of an address."
    status={error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
    actions={<>
        <Button variant="ghost" onClick={onBack}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>Verify signature</Button>
    </>}
>
    <Input label="Address" ... />
    <Textarea label="Message" ... />
</FormPage>`}
            </Markup>
            <TemplateExample label="FormPage: bare below 600px, one centred card at 600px and up" render={() => <ExampleFormScreen />} />
            <TemplateExample label="FormPage with a status message above the actions" render={() => <ExampleFormScreen withError />} />
        </Section>
    );
}
