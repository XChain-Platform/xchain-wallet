// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const NEW_OWNER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const SOURCE = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

const ADMIN_ACTION_PATTERN = /^(Lock token|Update description|Transfer ownership|Update mint settings|Update callback settings|Update access lists|Update bridge settings)$/;
const adminAction = () => screen.getByRole('button', { name: ADMIN_ACTION_PATTERN });

function mountAdmin(mode, overrides = {}, initialTick = 'TOKEN') {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE.address,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [
                        { tick: 'DIVISIBLE', quantity: '10', divisibility: 8 },
                        { tick: 'PENDING', quantity: '10', divisibility: 0 },
                        { tick: 'PAY', quantity: '10', divisibility: 0 },
                    ],
                },
            }],
        }),
        getTokenInfo: vi.fn().mockResolvedValue({ tick: initialTick, creator: SOURCE.address, locks: {} }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        ...overrides,
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue({});
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenAdminForm
                walletId="w"
                mode={mode}
                initialChainId={CHAIN}
                initialTick={initialTick}
                initialFromAddress={SOURCE.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

async function pickCallbackToken(tick) {
    fireEvent.click(await screen.findByRole('button', { name: /^Callback token:/ }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^Select ${tick} on Bitcoin`) }));
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('TokenAdminForm review interaction safety', () => {
    it('gives the Network, Token and Callback token fields a help tip', async () => {
        mountAdmin('callback-settings', {}, '');
        await screen.findByLabelText('From');
        expect(screen.getByRole('button', { name: 'About Network' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'About Token' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'About Callback token' })).toBeTruthy();
    });

    it.each([
        ['lock', 'Lock token'],
        ['description', 'Update description'],
        ['transfer', 'Transfer ownership'],
        ['mint-settings', 'Update mint settings'],
        ['callback-settings', 'Update callback settings'],
        ['access-lists', 'Update access lists'],
        ['bridge-settings', 'Update bridge settings'],
    ])('names the watcher %s action %s', async (mode, label) => {
        mountAdmin(mode);

        expect(await screen.findByRole('button', { name: label })).toHaveAccessibleName(label);
        expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    });

    it('keeps a lowercase managed ticker exact in the composed admin action', async () => {
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({
            psbtHex: '70736274ff00',
            chainId: CHAIN,
        });
        mountAdmin('description', { buildActionPsbtRequest }, 'caseSensitive');

        fireEvent.change(await screen.findByLabelText('Description'), {
            target: { value: 'Exact ticker update' },
        });
        const preview = adminAction();
        await waitFor(() => expect(preview).toBeEnabled());
        fireEvent.click(preview);
        expect(await screen.findByText(
            'Watcher mode: this prepares the transaction for your offline signer. Sign it there, then bring the signed transaction to a wallet that can broadcast it.',
        )).toBeInTheDocument();
        fireEvent.submit(await screen.findByRole('form', { name: 'Review description update' }));

        await waitFor(() => expect(buildActionPsbtRequest).toHaveBeenCalled());
        const params = buildActionPsbtRequest.mock.calls[0][0].actionData.params;
        expect(params.TICK).toBe('caseSensitive');
    });

    it('rejects an overlong managed-token description before review', async () => {
        const buildActionPsbtRequest = vi.fn();
        mountAdmin('description', { buildActionPsbtRequest });

        fireEvent.change(await screen.findByLabelText('Description'), {
            target: { value: '<b>markup</b>'.repeat(700) },
        });
        const preview = adminAction();
        await waitFor(() => expect(preview).toBeEnabled());
        fireEvent.click(preview);

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Description cannot be longer than 249 characters.');
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('states that an ownership transfer cannot be undone on review', async () => {
        mountAdmin('transfer', {
            getTokenInfo: vi.fn().mockResolvedValue({
                chainId: CHAIN,
                tick: 'TOKEN',
                creator: SOURCE.address,
                locks: {},
            }),
        });

        fireEvent.change(await screen.findByLabelText('New owner address'), {
            target: { value: NEW_OWNER },
        });
        const preview = adminAction();
        await waitFor(() => expect(preview).toBeEnabled());
        fireEvent.click(preview);

        expect(await screen.findByText(/Transferring ownership cannot be undone/))
            .toBeInTheDocument();
    });

    it('refuses an admin action when this wallet is not the token owner', async () => {
        const buildActionPsbtRequest = vi.fn();
        mountAdmin('transfer', {
            getTokenInfo: vi.fn().mockResolvedValue({
                chainId: CHAIN,
                tick: 'TOKEN',
                creator: NEW_OWNER,
                locks: {},
            }),
            buildActionPsbtRequest,
        });

        fireEvent.change(await screen.findByLabelText('New owner address'), {
            target: { value: NEW_OWNER },
        });

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'This wallet does not own TOKEN.',
        );
        expect(adminAction()).toBeDisabled();
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses an admin action before review when the issuer is unknown', async () => {
        const buildActionPsbtRequest = vi.fn();
        mountAdmin('transfer', {
            getTokenInfo: vi.fn().mockResolvedValue({
                chainId: CHAIN,
                tick: 'TOKEN',
                creator: null,
                locks: {},
            }),
            buildActionPsbtRequest,
        });

        expect(await screen.findByRole('alert')).toHaveTextContent(
            "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.",
        );
        expect(adminAction()).toBeDisabled();
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses a description update after the description is locked', async () => {
        const buildActionPsbtRequest = vi.fn();
        mountAdmin('description', {
            getTokenInfo: vi.fn().mockResolvedValue({
                chainId: CHAIN,
                tick: 'TOKEN',
                creator: SOURCE.address,
                locks: { description: true },
            }),
            buildActionPsbtRequest,
        });

        const description = await screen.findByLabelText('Description');
        await waitFor(() => expect(description).toBeDisabled());
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Description is permanently locked for TOKEN and cannot be updated.',
        );
        expect(adminAction()).toBeDisabled();
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses a hostile description before watcher review', async () => {
        const buildActionPsbtRequest = vi.fn();
        mountAdmin('description', { buildActionPsbtRequest });
        fireEvent.change(await screen.findByLabelText('Description'), {
            target: { value: 'safe\u202eunsafe' },
        });

        fireEvent.click(adminAction());

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Description cannot contain text-direction control characters.');
        expect(screen.queryByRole('form', { name: 'Review description update' })).toBeNull();
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('does not offer already-locked supply and description flags again', async () => {
        mountAdmin('lock', {
            getTokenInfo: vi.fn().mockResolvedValue({
                chainId: CHAIN,
                tick: 'TOKEN',
                creator: SOURCE.address,
                locks: { max_supply: true, description: true },
            }),
        });

        await waitFor(() => {
            const maxSupply = screen.getByLabelText(/^Max supply/);
            const description = screen.getByLabelText(/^Description/);
            expect(maxSupply).toBeChecked();
            expect(maxSupply).toBeDisabled();
            expect(description).toBeChecked();
            expect(description).toBeDisabled();
        });
    });

    it('requires a fresh lock confirmation after going back', async () => {
        mountAdmin('lock');

        fireEvent.click(await screen.findByLabelText('Max supply'));
        const preview = adminAction();
        await waitFor(() => expect(preview).toBeEnabled());
        fireEvent.click(preview);
        fireEvent.change(await screen.findByLabelText('Type LOCK to confirm'), {
            target: { value: 'LOCK' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        fireEvent.click(adminAction());

        expect(await screen.findByLabelText('Type LOCK to confirm')).toHaveValue('');
        expect(screen.getByRole('button', { name: /Create unsigned transaction/ })).toBeDisabled();
    });

    it('keeps the irreversible warning in confirmation instead of above the lock flags', async () => {
        mountAdmin('lock');

        expect(await screen.findByText(/^No one can ever run a callback on this token again/))
            .toHaveTextContent('No one can ever run a callback on this token again, and its block, token and amount never change');
        expect(screen.queryByText('Locking is permanent.')).toBeNull();

        fireEvent.click(screen.getByLabelText('Callback'));
        const preview = adminAction();
        await waitFor(() => expect(preview).toBeEnabled());
        fireEvent.click(preview);

        const confirmation = await screen.findByLabelText('Type LOCK to confirm');
        expect(screen.getByRole('button', { name: /Create unsigned transaction/ })).toBeDisabled();
        fireEvent.change(confirmation, { target: { value: 'LOCK' } });
        expect(screen.getByRole('button', { name: /Create unsigned transaction/ })).toBeEnabled();
    });

    it('picks the callback token from held tokens on the form network', async () => {
        mountAdmin('callback-settings', {
            tokenHolderSummary: vi.fn().mockResolvedValue({ isDistributed: false }),
        });

        const field = await screen.findByRole('button', { name: 'Callback token: Select a token' });
        fireEvent.click(field);
        expect(await screen.findByRole('heading', { name: 'Select callback token' })).toBeInTheDocument();
        fireEvent.click(await screen.findByRole('button', { name: /^Select PAY on Bitcoin/ }));

        expect(await screen.findByRole('button', { name: 'Callback token: PAY on Bitcoin' }))
            .toBeInTheDocument();
    });

    it('starts only one watcher build when review is submitted twice', async () => {
        let resolveBuild;
        const buildActionPsbtRequest = vi.fn(() => new Promise((resolve) => {
            resolveBuild = resolve;
        }));
        mountAdmin('description', { buildActionPsbtRequest });

        fireEvent.change(await screen.findByLabelText('Description'), {
            target: { value: 'Updated once' },
        });
        const preview = adminAction();
        await waitFor(() => expect(preview).toBeEnabled());
        fireEvent.click(preview);
        const review = await screen.findByRole('form', { name: 'Review description update' });

        act(() => {
            review.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            review.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });

        expect(buildActionPsbtRequest).toHaveBeenCalledTimes(1);
        await act(async () => {
            resolveBuild({ psbtHex: '70736274ff00', chainId: CHAIN });
        });
        expect(await screen.findByLabelText('Unsigned transaction code')).toBeTruthy();
    });

    it('does not use the previous callback token availability while typing', async () => {
        let resolveNext;
        const nextInfo = new Promise((resolve) => { resolveNext = resolve; });
        const getTokenInfo = vi.fn(({ tick }) => {
            if (tick === 'TOKEN') {
                return Promise.resolve({ chainId: CHAIN, tick, creator: SOURCE.address, locks: {} });
            }
            if (tick === 'DIVISIBLE') {
                return Promise.resolve({ chainId: CHAIN, tick, divisibility: 8 });
            }
            return nextInfo;
        });
        mountAdmin('callback-settings', {
            getTokenInfo,
            tokenHolderSummary: vi.fn().mockResolvedValue({ isDistributed: false }),
        });

        await screen.findByRole('button', { name: /^Callback token:/ });
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith({
            chainId: CHAIN,
            tick: 'TOKEN',
            demo: false,
        }));
        await pickCallbackToken('DIVISIBLE');
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith({
            chainId: CHAIN,
            tick: 'DIVISIBLE',
            demo: false,
        }));
        await pickCallbackToken('PENDING');
        fireEvent.change(screen.getByLabelText('Payout per unit'), {
            target: { value: '0.5' },
        });
        fireEvent.change(screen.getByLabelText('Callback allowed from block'), {
            target: { value: '100' },
        });
        fireEvent.click(adminAction());

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Callback amount must be a whole number until the wallet confirms whether PENDING supports decimals.',
        );
        await act(async () => {
            resolveNext({ chainId: CHAIN, tick: 'PENDING', divisibility: 0 });
        });
    });

    it('rejects exponent notation in a callback amount before review', async () => {
        const buildActionPsbtRequest = vi.fn();
        mountAdmin('callback-settings', {
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            tokenHolderSummary: vi.fn().mockResolvedValue({ isDistributed: false }),
            buildActionPsbtRequest,
        });
        await pickCallbackToken('PAY');
        fireEvent.change(screen.getByLabelText('Payout per unit'), {
            target: { value: '1e2' },
        });
        fireEvent.change(screen.getByLabelText('Callback allowed from block'), {
            target: { value: '101' },
        });
        const preview = adminAction();
        await waitFor(() => expect(preview).toBeEnabled());
        fireEvent.click(preview);

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Callback amount must be a positive number.');
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });
});

describe('Callback settings reads the holders again at Review', () => {
    // The indexer refuses a callback edit once supply is distributed, after the
    // fee is spent. The holder read that disables the fields can fail, or
    // predate the first transfer out, so Review reads it again.
    async function fillCallback(beforeReview = () => {}) {
        await pickCallbackToken('PAY');
        fireEvent.change(screen.getByLabelText('Payout per unit'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Callback allowed from block'), { target: { value: '150' } });
        const preview = adminAction();
        await waitFor(() => expect(preview).toBeEnabled());
        beforeReview();
        fireEvent.click(preview);
    }

    function base(tokenHolderSummary, buildActionPsbtRequest) {
        return {
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            getTokenInfo: vi.fn(async ({ tick }) => (
                tick === 'PAY'
                    ? { chainId: CHAIN, tick: 'PAY', divisibility: 0, creator: NEW_OWNER }
                    : { chainId: CHAIN, tick: 'TOKEN', creator: SOURCE.address, locks: {} }
            )),
            tokenHolderSummary,
            buildActionPsbtRequest,
        };
    }

    it('refuses while the holders cannot be read', async () => {
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({ psbtHex: '70736274ff00', chainId: CHAIN });
        mountAdmin('callback-settings', base(vi.fn().mockRejectedValue(new Error('explorer 500')), buildActionPsbtRequest));
        await fillCallback();
        expect(await screen.findByRole('alert')).toHaveTextContent(
            "Couldn't check whether TOKEN has holders. Callback settings can change only before any supply is distributed, so try again when the explorer answers.",
        );
        expect(screen.queryByRole('form', { name: /Review callback settings/ })).toBeNull();
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses when supply went out after the form opened', async () => {
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({ psbtHex: '70736274ff00', chainId: CHAIN });
        let distributed = false;
        const summary = vi.fn(async () => ({ isDistributed: distributed, holderCount: distributed ? 2 : 1 }));
        mountAdmin('callback-settings', base(summary, buildActionPsbtRequest));
        await fillCallback(() => { distributed = true; });
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Callback settings can only be changed before any supply is distributed. This token already has holders.',
        );
        expect(screen.queryByRole('form', { name: /Review callback settings/ })).toBeNull();
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('reaches review while supply is still undistributed', async () => {
        mountAdmin('callback-settings', base(vi.fn().mockResolvedValue({ isDistributed: false, holderCount: 1 }), vi.fn()));
        await fillCallback();
        expect(await screen.findByRole('form', { name: /Review callback settings/ })).toBeInTheDocument();
    });
});
