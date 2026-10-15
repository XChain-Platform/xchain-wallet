// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';

describe('FormPage onboarding layout', () => {
    it('keeps progress, title, body, status, and equal action stack in shared order', () => {
        const { container } = render(
            <FormPage
                label="Create wallet"
                progress={<span aria-current="step">Step 1 of 3</span>}
                topAction={<button type="button">Skip</button>}
                title="Create a new wallet"
                description="Encrypt this wallet on this device."
                status={<p>Ready</p>}
                actions={(
                    <>
                        <button type="button">Back</button>
                        <button type="submit">Next</button>
                    </>
                )}
                stackedActions
            >
                <input aria-label="Password" />
            </FormPage>,
        );

        const form = screen.getByRole('form', { name: 'Create wallet' });
        const children = [...form.children];
        expect(children[0]).toContainElement(screen.getByText('Step 1 of 3'));
        expect(children[0]).toContainElement(screen.getByRole('button', { name: 'Skip' }));
        expect(children[1]).toContainElement(screen.getByRole('heading', { name: 'Create a new wallet' }));
        expect(children[1]).toHaveTextContent('Encrypt this wallet on this device.');
        expect(children[2]).toContainElement(screen.getByLabelText('Password'));
        expect(children[3]).toHaveTextContent('Ready');
        expect(children[4]).toContainElement(screen.getByRole('button', { name: 'Back' }));
        expect(children[4]).toContainElement(screen.getByRole('button', { name: 'Next' }));
        expect(children[4].className.split(' ')).toHaveLength(2);
        expect(container.querySelectorAll('h1')).toHaveLength(1);
    });
});
