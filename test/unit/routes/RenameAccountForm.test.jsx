// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

const { RenameAccountForm } = await import(
    '../../../packages/core/src/shared/routes/RenameAccountForm.jsx');

function mount(overrides = {}) {
    const props = {
        accountId: 'account-1',
        initialName: 'Primary account',
        onBack: vi.fn(),
        onRenamed: vi.fn(),
        ...overrides,
    };
    const view = render(<RenameAccountForm {...props} />);
    return { ...view, props };
}

beforeEach(() => {
    messaging = { renameAccount: vi.fn().mockResolvedValue(undefined) };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe('RenameAccountForm name validation', () => {
    it('prefills the input with the initial name', () => {
        mount({ initialName: 'Savings' });

        expect(screen.getByLabelText('Account name').value).toBe('Savings');
    });

    it('disables Save for an empty or whitespace-only name', () => {
        mount({ initialName: '' });
        const input = screen.getByLabelText('Account name');
        const save = screen.getByRole('button', { name: 'Save' });

        expect(save.disabled).toBe(true);
        fireEvent.change(input, { target: { value: '   ' } });
        expect(save.disabled).toBe(true);
    });

    it('rejects a blank name submitted through the form', () => {
        mount({ initialName: '   ' });
        const input = screen.getByLabelText('Account name');

        fireEvent.submit(input.closest('form'));

        expect(screen.getByText('Account name is required.')).toBeTruthy();
        expect(messaging.renameAccount).not.toHaveBeenCalled();
    });
});

describe('RenameAccountForm submission', () => {
    it('trims a valid name, renames the account, and reports completion', async () => {
        const { props } = mount({ initialName: '  Spending  ' });

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(props.onRenamed).toHaveBeenCalledTimes(1));
        expect(messaging.renameAccount).toHaveBeenCalledTimes(1);
        expect(messaging.renameAccount).toHaveBeenCalledWith({
            accountId: 'account-1',
            name: 'Spending',
        });
        expect(messaging.renameAccount.mock.invocationCallOrder[0])
            .toBeLessThan(props.onRenamed.mock.invocationCallOrder[0]);
    });

    it('reports when the shell has no rename method', async () => {
        messaging = {};
        const { props } = mount();

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(
            'messaging.renameAccount is not available in this shell.',
        )).toBeTruthy();
        expect(props.onRenamed).not.toHaveBeenCalled();
    });
});

describe('RenameAccountForm submission failures', () => {
    it.each([
        [new Error('Rename refused'), 'Rename refused'],
        [{}, 'Failed to rename account.'],
    ])('shows the failure and does not report completion', async (failure, message) => {
        messaging.renameAccount.mockRejectedValue(failure);
        const { props } = mount();

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(message)).toBeTruthy();
        expect(props.onRenamed).not.toHaveBeenCalled();
    });

    it('clears a shown error when the user types', async () => {
        messaging.renameAccount.mockRejectedValue(new Error('Rename refused'));
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('Rename refused')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Account name'), {
            target: { value: 'Recovered name' },
        });

        expect(screen.queryByText('Rename refused')).toBeNull();
    });
});
