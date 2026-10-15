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
        expect(summary.querySelector('[aria-hidden="true"]')).toHaveTextContent('✕');
    });

    it('takes its colours, border and radius only from StatusMessage', () => {
        const css = readFileSync('packages/core/src/ui/FormErrorSummary.module.css', 'utf8');
        expect(css).not.toMatch(/border(-color)?:\s*1px|border-radius|var\(--xc-danger/);
        const src = readFileSync('packages/core/src/ui/FormErrorSummary.jsx', 'utf8');
        expect(src).toMatch(/statusStyles\.row\} \$\{statusStyles\.error/);
        expect(src).not.toMatch(/style=\{\{/);
    });
});
