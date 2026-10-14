// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { FormErrorSummary, Input } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function FormErrorSummarySection() {
    return (
        <Section
            id="form-error-summary"
            title="Form error summary"
            tag="TEMPLATE PART · FormErrorSummary"
            kicker="The validation summary in a FormPage status slot. It takes focus when a submit fails and lists each problem as a link that moves focus to the field that needs it."
        >
            <Guidance
                what={<>Props: <code>errors</code> (a list of <code>{'{ id, label, message }'}</code>; <code>id</code> is the field's input id and makes the entry a link), <code>focusKey</code> (change it on each submit attempt so a repeated failure takes focus again), <code>recovery</code> (an optional <code>{'{ label, onAction }'}</code> button, such as Use max). Renders nothing for an empty list.</>}
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
        </Section>
    );
}
