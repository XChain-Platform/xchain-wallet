// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { FieldNote, FormErrorSummary, FormNotice, FormPage, Input } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function FormErrorSummarySection() {
    return (
        <Section
            id="form-error-summary"
            title="Form error summary"
            tag="TEMPLATE PART · FormErrorSummary"
            kicker="The validation summary: a danger Notice that reads Fix N things to continue and lists each problem. FormPage and FormFrame render it from the form's useFormErrors object (errors={form}) at the top of the page; it takes focus once per failed submit, clears as each field is fixed, and has no X."
        >
            <Guidance
                what={<><code>useFormErrors()</code> gives <code>validate(map)</code> (field id to message, one pass for every field), <code>fail(message)</code> for a problem with no field, <code>clear(id)</code> and <code>reset()</code>. Pass the object as <code>errors</code> to FormPage or FormFrame; Input, Select, Textarea and IconSelect read their own entry by <code>id</code>, outline red with the line under, and clear on the user's change. The picker fields do the same (NetworkField and ChainPicker, TokenField, by <code>id</code> or <code>formErrorKey</code>; the From and Fees sections by <code>formErrorKey</code>) and clear when a pick changes their value. <code>errorAction</code> on FormPage or FormFrame gives the notice its one action, such as Use max.</>}
                when={<>Every form that validates on submit.</>}
                whenNot={<>Live per-keystroke feedback (the field's own <code>error</code>).</>}
                doRule={<>✓ Give each field an explicit <code>id</code> · collect every failing check into one <code>validate</code> call</>}
                dontRule={<>✗ Return on the first failure · wipe every error on any change</>}
            />
            <Markup>
{`const form = useFormErrors();
const ok = form.validate({ 'thing-name': name.trim() ? null : 'Enter a name.' });
<FormPage label="Create thing" onSubmit={onSubmit} errors={form} actions={...}>
    <Input id="thing-name" label="Name" ... />
</FormPage>`}
            </Markup>
            <Guidance
                what={<>Props: <code>errors</code> (a list of <code>{'{ id, label, message }'}</code>; <code>id</code> is the field's input id and makes the entry a link), <code>focusKey</code> (change it on each submit attempt so a repeated failure takes focus again), <code>form</code> (the <code>useFormErrors</code> object, in place of <code>errors</code> and <code>focusKey</code>), <code>action</code> (an optional <code>{'{ label, onAction }'}</code> button, such as Use max; <code>recovery</code> is the older name). Renders nothing for an empty list.</>}
                when={<>A form submit that failed validation, with one or more field errors or a form-level error the user can fix on this page.</>}
                whenNot={<>A network or signing failure the user cannot fix in a field (StatusMessage variant="error") · live per-keystroke feedback (the field's own <code>error</code>).</>}
                sizing={<>Full form width, <code>--xc-space-3</code> padding, <code>--xc-radius-md</code>, a danger border and text. One line of heading, then a list.</>}
                doRule={<>✓ Pass it as FormPage <code>status</code> · keep each field's own error too, so the summary and the field agree · give every field-specific entry the field's <code>id</code></>}
                dontRule={<>✗ Put it between fields · repeat the field label inside <code>message</code> when <code>label</code> already names it</>}
            />
            <Markup>
{`<FormPage
    label="Send"
    onSubmit={handleReview}
    status={<FormErrorSummary errors={formErrors} focusKey={validationAttempt} />}
    actions={<Button type="submit" variant="primary">Send</Button>}
>
    <Input id="send-to" label="To" error={toError} ... />
</FormPage>`}
            </Markup>
            <LiveExample label="Two field errors, each linked to its field">
                <FormErrorSummary
                    errors={[
                        { id: 'sg-summary-to', label: 'To', message: 'Destination address is required.' },
                        { id: 'sg-summary-amount', label: 'Amount', message: 'Amount must be a positive number.' },
                    ]}
                />
                <Input id="sg-summary-to" label="To" error="Destination address is required." onChange={() => {}} />
                <Input id="sg-summary-amount" label="Amount" error="Amount must be a positive number." onChange={() => {}} />
            </LiveExample>
            <Guidance
                what={<>FormNotice: a plain-string notice written in the middle of a form body that FormPage shows with its other notices as the first item of the page content. Props: <code>tone</code> (info, danger or success; <code>variant</code> is the older name, default warning), <code>title</code> (a bold line above the text, such as "Destroy is irreversible."; <code>lead</code> is the older alias), <code>role</code>, <code>testId</code>, <code>onDismiss</code>, and the text as children, or <code>lines</code> (an array of strings, with <code>bullets</code> to show separate issues as a list) for one message of several paragraphs, such as a decoder's warnings.</>}
                when={<>A fact about the whole form that a field or control knows only once it renders, such as the fee selector's fallback-rate note.</>}
                whenNot={<>A field problem (the field's own <code>error</code>) · text that is not a plain string, which renders in place.</>}
                sizing={<>The StatusMessage row, at full content width, first in the page content (above the card when wide), with the form gap between stacked notices.</>}
                doRule={<>✓ Write it next to the control that raises it · keep the text a plain string</>}
                dontRule={<>✗ Render a StatusMessage between fields</>}
            />
            <LiveExample label="Written beside the field, shown at the top">
                <FormPage as="div">
                    <Input id="sg-notice-amount" label="Amount" onChange={() => {}} />
                    <FormNotice variant="warning">Check the amount before continuing.</FormNotice>
                </FormPage>
            </LiveExample>
            <Guidance
                what={<>FieldNote: a toned line under one field, or beside one item of a review summary, drawn like a field error (a glyph and small toned text) with no box. Props: <code>variant</code> (warning, error, info or success; default warning), <code>action</code> (a slot for a small recovery control such as Clear), <code>role</code> (alert by default for warning and error), <code>id</code> for the field's <code>aria-describedby</code>, and the text as children or <code>lines</code>.</>}
                when={<>A caution about one field's value that is not a validation error (a pasted or lookalike address) · a note about one decoded item in a review list.</>}
                whenNot={<>A message about the whole form or its context, such as a wrong network or a missing owner address (FormNotice) · a validation error on an Input (its own <code>error</code>).</>}
                sizing={<>The field help line: <code>--xc-text-xs</code>, <code>--xc-help-gap</code> above, the prose width.</>}
                doRule={<>✓ Place it directly under the field or item it is about</>}
                dontRule={<>✗ Use it for a page-level state · put a StatusMessage box in its place</>}
            />
            <LiveExample label="Under the field it is about">
                <FormPage as="div">
                    <Input id="sg-field-note-to" label="To" onChange={() => {}} />
                    <FieldNote>This address looks like one of your contacts. Check every character.</FieldNote>
                </FormPage>
            </LiveExample>
        </Section>
    );
}
