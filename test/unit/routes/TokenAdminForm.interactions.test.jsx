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

function mountAdmin(mode, overrides = {}, initialTick = 'TOKEN') {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
        getTokenInfo: vi.fn().mockResolvedValue({ tick: initialTick, locks: {} }),
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

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('TokenAdminForm review interaction safety', () => {
    it('keeps a lowercase managed ticker exact in the composed admin action', async () => {
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({
            psbtHex: '70736274ff00',
            chainId: CHAIN,
        });
        mountAdmin('description', { buildActionPsbtRequest }, 'caseSensitive');

        fireEvent.change(await screen.findByLabelText('New description'), {
            target: { value: 'Exact ticker update' },
        });
        const preview = screen.getByRole('button', { name: 'Preview' });
        await waitFor(() => expect(preview).toBeEnabled());
        fireEvent.click(preview);
        fireEvent.submit(await screen.findByRole('form', { name: 'Review description update' }));

        await waitFor(() => expect(buildActionPsbtRequest).toHaveBeenCalled());
        const params = buildActionPsbtRequest.mock.calls[0][0].actionData.params;
        expect(params.TICK).toBe('caseSensitive');
    });

    it('rejects an overlong managed-token description before review', async () => {
        const buildActionPsbtRequest = vi.fn();
        mountAdmin('description', { buildActionPsbtRequest });

        fireEvent.change(await screen.findByLabelText('New description'), {
            target: { value: '<b>markup</b>'.repeat(700) },
        });
        const preview = screen.getByRole('button', { name: 'Preview' });
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
        const preview = screen.getByRole('button', { name: 'Preview' });
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
        expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
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

        const description = await screen.findByLabelText('New description');
        await waitFor(() => expect(description).toBeDisabled());
        expect(screen.getByRole('alert')).toHaveTextContent(
            'The description for TOKEN is permanently locked and cannot be updated.',
        );
        expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses a hostile description before watcher review', async () => {
        const buildActionPsbtRequest = vi.fn();
        mountAdmin('description', { buildActionPsbtRequest });
        fireEvent.change(await screen.findByLabelText('New description'), {
            target: { value: 'safe\u202eunsafe' },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

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
        const preview = screen.getByRole('button', { name: 'Preview' });
        await waitFor(() => expect(preview).toBeEnabled());
        fireEvent.click(preview);
        fireEvent.change(await screen.findByLabelText('Type LOCK to confirm'), {
            target: { value: 'LOCK' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        expect(await screen.findByLabelText('Type LOCK to confirm')).toHaveValue('');
        expect(screen.getByRole('button', { name: /Create unsigned transaction/ })).toBeDisabled();
    });

    it('starts only one watcher build when review is submitted twice', async () => {
        let resolveBuild;
        const buildActionPsbtRequest = vi.fn(() => new Promise((resolve) => {
            resolveBuild = resolve;
        }));
        mountAdmin('description', { buildActionPsbtRequest });

        fireEvent.change(await screen.findByLabelText('New description'), {
            target: { value: 'Updated once' },
        });
        const preview = screen.getByRole('button', { name: 'Preview' });
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
        expect(await screen.findByLabelText('Unsigned transaction hex')).toBeTruthy();
    });

    it('does not use the previous callback token availability while typing', async () => {
        let resolveNext;
        const nextInfo = new Promise((resolve) => { resolveNext = resolve; });
        const getTokenInfo = vi.fn(({ tick }) => {
            if (tick === 'TOKEN') {
                return Promise.resolve({ chainId: CHAIN, tick, locks: {} });
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

        const callbackToken = await screen.findByLabelText('Callback token');
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith({
            chainId: CHAIN,
            tick: 'TOKEN',
            demo: false,
        }));
        fireEvent.change(callbackToken, { target: { value: 'DIVISIBLE' } });
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith({
            chainId: CHAIN,
            tick: 'DIVISIBLE',
            demo: false,
        }));
        fireEvent.change(callbackToken, { target: { value: 'PENDING' } });
        fireEvent.change(screen.getByLabelText('Payout per unit'), {
            target: { value: '0.5' },
        });
        fireEvent.change(screen.getByLabelText('Callback allowed from block'), {
            target: { value: '100' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

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
        fireEvent.change(await screen.findByLabelText('Callback token'), {
            target: { value: 'PAY' },
        });
        fireEvent.change(screen.getByLabelText('Payout per unit'), {
            target: { value: '1e2' },
        });
        fireEvent.change(screen.getByLabelText('Callback allowed from block'), {
            target: { value: '101' },
        });
        const preview = screen.getByRole('button', { name: 'Preview' });
        await waitFor(() => expect(preview).toBeEnabled());
        fireEvent.click(preview);

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Callback amount must be a positive number.');
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });
});
