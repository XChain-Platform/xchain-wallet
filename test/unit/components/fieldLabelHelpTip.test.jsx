// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AmountField } from '../../../packages/core/src/shared/components/AmountField.jsx';
import { Input } from '../../../packages/core/src/ui/Input.jsx';
import { RadioGroup } from '../../../packages/core/src/ui/RadioGroup.jsx';
import { Select } from '../../../packages/core/src/ui/Select.jsx';
import { Textarea } from '../../../packages/core/src/ui/Textarea.jsx';

afterEach(cleanup);

const FIELD_CASES = [
    {
        name: 'Input',
        label: 'Fee rate',
        selector: 'input',
        help: 'Choose the fee paid for each byte.',
        renderField: (props = {}) => (
            <Input
                label="Fee rate"
                optional
                maxLength={20}
                defaultValue="12"
                fieldAction={<span data-field-action>Action</span>}
                {...props}
            />
        ),
        hasCounter: true,
        hasAction: true,
    },
    {
        name: 'Textarea',
        label: 'Memo',
        selector: 'textarea',
        help: 'Add a public note to this transaction.',
        renderField: (props = {}) => (
            <Textarea label="Memo" optional maxLength={250} defaultValue="" {...props} />
        ),
        hasCounter: true,
        hasAction: false,
    },
    {
        name: 'Select',
        label: 'Network',
        selector: 'select',
        help: 'Choose the network for this transaction.',
        renderField: (props = {}) => (
            <Select label="Network" optional defaultValue="mainnet" {...props}>
                <option value="mainnet">Mainnet</option>
            </Select>
        ),
        hasCounter: false,
        hasAction: false,
    },
];

describe('field label help tip', () => {
    it.each(FIELD_CASES)(
        'places $name help after the Optional pill and before the counter',
        ({ label, selector, help, renderField, hasCounter, hasAction }) => {
            const { container } = render(renderField({ help }));
            const control = screen.getByLabelText(label, { selector });
            const tip = screen.getByRole('button', { name: `About ${label}` });
            const tipWrap = tip.parentElement;
            const labelNode = container.querySelector(`label[for="${control.id}"]`);
            const pill = container.querySelector('[data-optional-pill]');
            const row = tipWrap.parentElement;
            const counter = hasCounter
                ? screen.getByText(selector === 'textarea' ? '0 / 250' : '2 / 20')
                : null;
            const action = hasAction ? container.querySelector('[data-field-action]') : null;

            expect(row).toContainElement(labelNode);
            expect(row).not.toContainElement(control);
            expect([...row.children]).toEqual([
                labelNode,
                pill,
                tipWrap,
                ...(counter ? [counter] : []),
            ]);
            if (action) {
                expect(row).not.toContainElement(action);
                expect(control.parentElement).toContainElement(action);
            }
            expect(screen.queryByRole('button', { name: label })).toBeNull();

            fireEvent.click(tip);
            expect(screen.getByRole('tooltip')).toHaveTextContent(help);
        },
    );

    it.each(FIELD_CASES)('renders no $name tip without help', ({ renderField }) => {
        render(renderField());

        expect(screen.queryByRole('button', { name: /^About / })).toBeNull();
        expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    });

    it.each(FIELD_CASES)(
        'renders no $name tip or help text without a visible label',
        ({ selector, help, renderField }) => {
            render(renderField({ label: undefined, help, 'aria-label': 'Unlabelled control' }));

            expect(screen.getByLabelText('Unlabelled control', { selector })).toBeTruthy();
            expect(screen.queryByRole('button')).toBeNull();
            expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
            expect(screen.queryByText(help)).toBeNull();
        },
    );

    it.each(FIELD_CASES)(
        'names the $name tip after the field when its label is markup',
        ({ name, selector, help, renderField }) => {
            const markupLabel = <>Ticker <span>Required</span></>;
            const { unmount } = render(renderField({ label: markupLabel, help, 'aria-label': 'Ticker' }));
            expect(screen.getByRole('button', { name: 'About Ticker' })).toBeTruthy();
            expect(document.body.innerHTML).not.toContain('[object Object]');
            unmount();

            // Without an aria-label the tip reads the label's own text.
            render(renderField({ label: markupLabel, help }));
            expect(screen.getByRole('button', { name: 'About Ticker Required' })).toBeTruthy();
            expect(document.querySelector(selector), name).toBeTruthy();
        },
    );

    it('names the RadioGroup tip after a markup legend by its text', () => {
        render(
            <RadioGroup
                legend={<>Signing mode <span>Required</span></>}
                value="auto"
                onChange={() => {}}
                options={[{ value: 'auto', label: 'Automatic' }]}
                help="Set from the signing public key."
            />,
        );

        expect(screen.getByRole('button', { name: 'About Signing mode Required' })).toBeTruthy();
    });

    it('passes AmountField help to its labelled Input', () => {
        render(
            <AmountField
                label="Amount"
                amount=""
                help="Enter the amount to send."
                onAmountFieldChange={() => {}}
            />,
        );

        expect(screen.getByLabelText('Amount', { selector: 'input' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'About Amount' }));
        expect(screen.getByRole('tooltip')).toHaveTextContent('Enter the amount to send.');
    });

    it('carries RadioGroup help on the legend line and keeps the group named by the legend', () => {
        render(
            <RadioGroup
                legend="Signing mode"
                value="auto"
                onChange={() => {}}
                options={[{ value: 'auto', label: 'Automatic' }]}
                help="Set from the signing public key."
            />,
        );

        const tip = screen.getByRole('button', { name: 'About Signing mode' });
        expect(tip.closest('legend')).toHaveTextContent('Signing mode');
        expect(screen.getByRole('group', { name: 'Signing mode' })).toBeTruthy();
        fireEvent.click(tip);
        expect(screen.getByRole('tooltip')).toHaveTextContent('Set from the signing public key.');
    });
});
