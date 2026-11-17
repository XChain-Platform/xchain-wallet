// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { FormErrorSummary } from '../../../packages/core/src/ui/FormErrorSummary.jsx';
import { StatusMessage } from '../../../packages/core/src/ui/StatusMessage.jsx';

afterEach(cleanup);

describe('FormErrorSummary presentation', () => {
    it('is the same error row as StatusMessage, not a hand-styled outline', () => {
        render(
            <>
                <FormErrorSummary errors={[{ id: 'amount', label: 'Amount', message: 'Enter an amount.' }]} focusKey={1} />
                <StatusMessage variant="error">Could not send.</StatusMessage>
            </>,
        );
        const summary = screen.getByRole('alert', { name: 'Form errors' });
        const message = screen.getByText('Could not send.').closest('[data-variant]');
        expect(summary).not.toHaveAttribute('style');
        expect(summary).toHaveAttribute('data-variant', 'error');
        // Every class the StatusMessage error row carries is on the summary too.
        for (const name of message.className.split(/\s+/).filter(Boolean)) {
            expect(summary).toHaveClass(name);
        }
        // The danger icon, a circled !, never an X (an X means dismiss), and
        // no close control: the notice clears itself.
        expect(summary).toHaveAttribute('data-tone', 'danger');
        expect(summary.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
        expect(summary.querySelector('[aria-hidden="true"]')).not.toHaveTextContent('✕');
        expect(summary.querySelector('[data-notice-dismiss]')).toBeNull();
    });

    it('lists the problems in plain text under a count title, with no links', () => {
        render(
            <FormErrorSummary
                errors={[
                    { id: 'pw', label: 'Password', message: 'Password must be at least 8 characters.' },
                    { id: 'confirm', message: 'Passwords do not match.' },
                ]}
                focusKey={1}
            />,
        );
        const summary = screen.getByRole('alert', { name: 'Form errors' });
        expect(summary.querySelector('a')).toBeNull();
        expect(summary).toHaveTextContent('Fix 2 things to continue');
        expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
            'Password must be at least 8 characters.',
            'Passwords do not match.',
        ]);
    });

    it('takes its colours, border and radius only from StatusMessage', () => {
        const css = readFileSync('packages/core/src/ui/FormErrorSummary.module.css', 'utf8');
        expect(css).not.toMatch(/border(-color)?:\s*1px|border-radius|var\(--xc-danger/);
        const src = readFileSync('packages/core/src/ui/FormErrorSummary.jsx', 'utf8');
        expect(src).toMatch(/statusStyles\.row\} \$\{statusStyles\.error/);
        expect(src).not.toMatch(/style=\{\{/);
    });
});
