// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Load-failure copy on the agent-account detail screen.
//
// `getCoSignerAccount` throws its own precondition errors prefixed with
// the function name ("getCoSignerAccount: id is required"), and those
// cross the shell messaging boundary intact: MessageHost's
// hydrateEnvelopeError rebuilds the Error from {name, message} without
// touching the text. So a screen doing `setError(err.message)` paints a
// developer string, which is what this screen used to do.
//
// The three cases below are the whole contract of the filter, asserted
// against the rendered DOM rather than against the helper in isolation,
// because the helper already had unit coverage while the wiring did not.

import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerAccountDetail } from '../../../packages/core/src/shared/routes/CoSignerAccountDetail.jsx';
import { updateCoSignerAccount } from '../../../packages/core/src/flows/updateCoSignerAccount.js';

function mountRejecting(err) {
    const messaging = {
        getSettings: () => Promise.resolve({}),
        getCoSignerAccount: () => Promise.reject(err),
    };
    return render(
        <MessagingProvider shell="extension" messaging={messaging}>
            <CoSignerAccountDetail accountId="acct-1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

function mountAccount() {
    const messaging = {
        getSettings: () => Promise.resolve({}),
        getCoSignerAccount: () => Promise.resolve({
            id: 'acct-1',
            name: 'Treasury agent',
            chainId: 'bitcoin-regtest',
            aggregateAddress: 'bcrt1qfundingaddress',
            enabled: true,
            policy: { allowedActions: [] },
            window: { entries: [] },
        }),
    };
    return render(
        <MessagingProvider shell="extension" messaging={messaging}>
            <CoSignerAccountDetail accountId="acct-1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

function account(overrides = {}) {
    return {
        id: 'acct-1',
        name: 'Treasury agent',
        chainId: 'bitcoin-regtest',
        aggregateAddress: 'bcrt1qfundingaddress',
        enabled: true,
        policy: { allowedActions: ['SEND'] },
        allowedOutputs: [],
        window: { entries: [] },
        ...overrides,
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

describe('CoSignerAccountDetail load-error copy', () => {
    it('shows house copy when the flow throws its function-prefixed precondition error', async () => {
        mountRejecting(new Error('getCoSignerAccount: id is required'));
        await waitFor(() => {
            expect(screen.getByText('Failed to load the agent account.')).toBeTruthy();
        });
    });

    it('never paints the raw developer string', async () => {
        mountRejecting(new Error('getCoSignerAccount: vault is required'));
        await waitFor(() => {
            expect(screen.getByText('Failed to load the agent account.')).toBeTruthy();
        });
        // The filter is only worth having if the developer text is gone,
        // not merely accompanied by the fallback.
        expect(screen.queryByText(/getCoSignerAccount:/)).toBeNull();
    });

    it('passes a genuinely user-facing backend message straight through', async () => {
        // The filter must not become a translator: copy already written for
        // a person keeps its wording, or every backend explanation collapses
        // into the same generic sentence.
        mountRejecting(new Error('This agent account was revoked on another device.'));
        await waitFor(() => {
            expect(screen.getByText('This agent account was revoked on another device.')).toBeTruthy();
        });
    });
});

describe('CoSignerAccountDetail clipboard control', () => {
    it('names the funding address copied by the button', async () => {
        mountAccount();

        expect(await screen.findByRole('button', { name: 'Copy funding address' })).toBeTruthy();
    });
});

describe('CoSignerAccountDetail async state', () => {
    it('rejects a policy update whose editable baseline is stale', async () => {
        const put = vi.fn();
        const stored = account({ policy: { allowedActions: ['ISSUE'] } });

        await expect(updateCoSignerAccount({
            vault: { coSignerAccounts: { get: vi.fn().mockResolvedValue(stored), put } },
            id: stored.id,
            patch: {
                expectedEditable: {
                    name: stored.name,
                    policy: { allowedActions: ['SEND'] },
                    allowedOutputs: stored.allowedOutputs,
                },
                policy: { allowedActions: ['SEND'] },
            },
        })).rejects.toThrow(/changed after you opened the editor/i);
        expect(put).not.toHaveBeenCalled();
    });

    it('reloads a changed policy before save and refuses to overwrite it', async () => {
        const original = account();
        const newer = account({
            name: 'Updated elsewhere',
            policy: { allowedActions: ['ISSUE'] },
        });
        const getCoSignerAccount = vi.fn()
            .mockResolvedValueOnce(original)
            .mockResolvedValueOnce(newer);
        const updateCoSignerAccount = vi.fn();
        render(
            <MessagingProvider shell="extension" messaging={{ getCoSignerAccount, updateCoSignerAccount }}>
                <CoSignerAccountDetail accountId="acct-1" onBack={() => {}} />
            </MessagingProvider>,
        );

        await screen.findByText('Treasury agent');
        fireEvent.click(screen.getByRole('button', { name: 'Edit policy' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        expect(await screen.findByText(/changed after you opened the editor/i)).toBeTruthy();
        expect(updateCoSignerAccount).not.toHaveBeenCalled();
        expect(screen.getByRole('checkbox', { name: 'Issue' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Send' })).not.toBeChecked();
    });

    it('carries the fresh editable baseline into a successful policy update', async () => {
        const original = account();
        const updated = account({ name: 'Renamed agent' });
        const getCoSignerAccount = vi.fn().mockResolvedValue(original);
        const updateCoSignerAccount = vi.fn().mockResolvedValue(updated);
        render(
            <MessagingProvider shell="extension" messaging={{ getCoSignerAccount, updateCoSignerAccount }}>
                <CoSignerAccountDetail accountId="acct-1" onBack={() => {}} />
            </MessagingProvider>,
        );

        await screen.findByText('Treasury agent');
        fireEvent.click(screen.getByRole('button', { name: 'Edit policy' }));
        fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Renamed agent' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(updateCoSignerAccount).toHaveBeenCalledWith({
            id: 'acct-1',
            patch: {
                expectedEditable: {
                    name: original.name,
                    policy: original.policy,
                    allowedOutputs: original.allowedOutputs,
                },
                name: 'Renamed agent',
                policy: {
                    allowedActions: ['SEND'],
                    allowedDestinations: null,
                    maxPerAction: null,
                    maxPerWindow: null,
                    confirmAbove: null,
                },
                allowedOutputs: [],
            },
        }));
    });

    it('drops stale account and mutation state when the selected account changes', async () => {
        const secondLoad = deferred();
        const oldUpdate = deferred();
        const first = account({ id: 'acct-1', name: 'First account', enabled: false });
        const second = account({ id: 'acct-2', name: 'Second account', enabled: true });
        const getCoSignerAccount = vi.fn(({ id }) => id === 'acct-1'
            ? Promise.resolve(first)
            : secondLoad.promise);
        const updateCoSignerAccount = vi.fn(() => oldUpdate.promise);
        const messaging = { getCoSignerAccount, updateCoSignerAccount };
        const view = render(
            <MessagingProvider shell="extension" messaging={messaging}>
                <CoSignerAccountDetail accountId="acct-1" onBack={() => {}} />
            </MessagingProvider>,
        );

        await screen.findByText('First account');
        fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
        await waitFor(() => expect(updateCoSignerAccount).toHaveBeenCalledTimes(1));

        view.rerender(
            <MessagingProvider shell="extension" messaging={messaging}>
                <CoSignerAccountDetail accountId="acct-2" onBack={() => {}} />
            </MessagingProvider>,
        );
        expect(screen.queryByText('First account')).toBeNull();
        expect(screen.getByText(/Loading/)).toBeTruthy();

        await act(async () => secondLoad.resolve(second));
        expect(await screen.findByText('Second account')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Disable' })).not.toBeDisabled();

        await act(async () => oldUpdate.resolve({ ...first, enabled: true }));
        expect(screen.getByText('Second account')).toBeTruthy();
        expect(screen.queryByText('First account')).toBeNull();
    });
});
