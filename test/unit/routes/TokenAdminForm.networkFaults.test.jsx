// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Token admin forms under failed, slow and stale network reads: a token record
// that never arrives keeps the action closed, a record read for one token never
// shapes the action composed for another, display-only list reads never block
// or invent a member count, and one press composes one action.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ onSelect }) => (
        <div>
            <button type="button" onClick={() => onSelect({ chainId: 'bitcoin-mainnet', tick: 'ALPHA' })}>Pick ALPHA</button>
            <button type="button" onClick={() => onSelect({ chainId: 'bitcoin-mainnet', tick: 'BETA' })}>Pick BETA</button>
        </div>
    ),
}));

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function mount(mode, overrides = {}, { initialTick = 'TOKEN', lockedTokenProps = true } = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: initialTick, creator: SOURCE.address, locks: {},
        }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: '70736274ff00', chainId: CHAIN }),
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
                initialTick={lockedTokenProps ? initialTick : undefined}
                initialFromAddress={SOURCE.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return target;
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('TokenAdminForm token record read faults', () => {
    for (const mode of ['lock', 'access-lists']) {
        it(`keeps ${mode} closed and composes nothing when the token read fails`, async () => {
            const target = mount(mode, {
                getTokenInfo: vi.fn().mockRejectedValue(new Error('explorer unreachable')),
            });
            const preview = await screen.findByRole('button', { name: 'Preview' });
            await act(async () => { await Promise.resolve(); });
            expect(preview).toBeDisabled();
            fireEvent.click(preview);
            expect(screen.queryByRole('form', { name: /Review/ })).toBeNull();
            expect(target.buildActionPsbtRequest).not.toHaveBeenCalled();
        });

        it(`keeps ${mode} closed and composes nothing while the token read never settles`, async () => {
            const target = mount(mode, {
                getTokenInfo: vi.fn(() => new Promise(() => {})),
            });
            const preview = await screen.findByRole('button', { name: 'Preview' });
            expect(preview).toBeDisabled();
            fireEvent.submit(preview.closest('form'));
            expect(screen.queryByRole('form', { name: /Review/ })).toBeNull();
            expect(target.buildActionPsbtRequest).not.toHaveBeenCalled();
        });
    }
});

describe('TokenAdminForm access lists across a token switch', () => {
    it('never carries one token\'s list bindings into another token\'s action', async () => {
        const betaRead = deferred();
        const getTokenInfo = vi.fn(({ tick }) => {
            if (tick === 'ALPHA') {
                return Promise.resolve({
                    chainId: CHAIN, tick: 'ALPHA', creator: SOURCE.address, locks: {}, allowList: '7', blockList: '9',
                });
            }
            return betaRead.promise;
        });
        const target = mount('access-lists', {
            getTokenInfo,
            getListByActionIndex: vi.fn(({ actionIndex }) => Promise.resolve({
                chainId: CHAIN, name: `Policy ${actionIndex}`, list: ['a'],
            })),
        }, { initialTick: '', lockedTokenProps: false });

        fireEvent.click(await screen.findByRole('button', { name: /^Token:/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Pick ALPHA' }));
        expect(await screen.findByText(/Policy 7 \(List #7\)/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^Token:/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Pick BETA' }));
        await act(async () => {
            betaRead.resolve({
                chainId: CHAIN, tick: 'BETA', creator: SOURCE.address, locks: {}, allowList: null, blockList: null,
            });
            await betaRead.promise;
        });

        const preview = screen.getByRole('button', { name: 'Preview' });
        if (!preview.disabled) {
            fireEvent.click(preview);
            const review = await screen.findByRole('form', { name: /Review/ }).catch(() => null);
            if (review) fireEvent.submit(review);
            await act(async () => { await Promise.resolve(); });
        }
        const composedLists = target.buildActionPsbtRequest.mock.calls
            .map((call) => call[0].actionData.params)
            .filter((params) => params.TICK === 'BETA' && (params.ALLOW_LIST === '7' || params.BLOCK_LIST === '9'));
        expect(composedLists).toEqual([]);
        expect(screen.queryByText(/List #7/)).toBeNull();
        expect(screen.queryByText(/List #9/)).toBeNull();
    });

    it('prefills the second token\'s bindings and composes against its record', async () => {
        const betaRead = deferred();
        const getTokenInfo = vi.fn(({ tick }) => {
            if (tick === 'ALPHA') {
                return Promise.resolve({
                    chainId: CHAIN, tick: 'ALPHA', creator: SOURCE.address, locks: {}, allowList: '5', blockList: '7',
                });
            }
            return betaRead.promise;
        });
        const target = mount('access-lists', {
            getTokenInfo,
            getListByActionIndex: vi.fn(({ actionIndex }) => Promise.resolve({
                chainId: CHAIN, name: `Policy ${actionIndex}`, list: ['a'],
            })),
            getListsForSource: vi.fn().mockResolvedValue([{ action_index: '55', type: '2', block_index: 1 }]),
        }, { initialTick: '', lockedTokenProps: false });

        fireEvent.click(await screen.findByRole('button', { name: /^Token:/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Pick ALPHA' }));
        expect(await screen.findByText(/Policy 5 \(List #5\)/)).toBeInTheDocument();
        expect(await screen.findByText(/Policy 7 \(List #7\)/)).toBeInTheDocument();

        // The owner picks a block-list for the first token, which marks the
        // block-list field as edited.
        fireEvent.click(screen.getByRole('button', { name: /(Choose|Change) block-list/ }));
        fireEvent.click(await screen.findByText(/Address list #55/));
        expect(await screen.findByText(/List #55/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^Token:/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Pick BETA' }));
        await act(async () => {
            betaRead.resolve({
                chainId: CHAIN, tick: 'BETA', creator: SOURCE.address, locks: {}, allowList: null, blockList: '9',
            });
            await betaRead.promise;
        });

        // The second token's own bindings show, and nothing from the first.
        expect(await screen.findByText(/Policy 9 \(List #9\)/)).toBeInTheDocument();
        expect(screen.getByText('None (anyone may interact)')).toBeInTheDocument();
        expect(screen.queryByText(/List #5\b/)).toBeNull();
        expect(screen.queryByText(/List #7\b/)).toBeNull();
        expect(screen.queryByText(/List #55/)).toBeNull();

        // Unchanged against the second token's record, so Preview stays closed.
        const preview = screen.getByRole('button', { name: 'Preview' });
        expect(preview).toBeDisabled();

        // A new allow-list composes only that change; the block-list matches
        // the second token's record and is left out.
        fireEvent.click(screen.getByRole('button', { name: /Choose allow-list/ }));
        fireEvent.click(await screen.findByText(/Address list #55/));
        const openPreview = await screen.findByRole('button', { name: 'Preview' });
        await waitFor(() => expect(openPreview).toBeEnabled());
        fireEvent.click(openPreview);
        fireEvent.submit(await screen.findByRole('form', { name: /Review/ }));
        await waitFor(() => expect(target.buildActionPsbtRequest).toHaveBeenCalledTimes(1));
        const params = target.buildActionPsbtRequest.mock.calls[0][0].actionData.params;
        expect(params.TICK).toBe('BETA');
        expect(params.ALLOW_LIST).toBe('55');
        expect(params.BLOCK_LIST).toBeUndefined();
    });
});

describe('TokenAdminForm lock matrix from a bare token record', () => {
    it('renders the lock state the record reports and composes only new locks', async () => {
        const target = mount('lock', {
            getTokenInfo: vi.fn().mockResolvedValue({ creator: SOURCE.address, locks: { max_supply: true } }),
        });
        const maxSupply = await screen.findByRole('checkbox', { name: /Max supply \(already locked\)/ });
        expect(maxSupply).toBeChecked();
        expect(maxSupply).toBeDisabled();
        const maxMint = screen.getByRole('checkbox', { name: /^Max mint per transaction/ });
        expect(maxMint).not.toBeChecked();
        expect(maxMint).toBeEnabled();
        expect(target.buildActionPsbtRequest).not.toHaveBeenCalled();
    });
});

describe('TokenAdminForm list detail read faults', () => {
    const cases = [
        ['rejects', () => Promise.reject(new Error('timeout'))],
        ['returns another chain', () => Promise.resolve({ chainId: 'litecoin-mainnet', name: 'Elsewhere', list: ['a', 'b', 'c'] })],
        ['returns members null', () => Promise.resolve({ members: null })],
    ];
    for (const [label, read] of cases) {
        it(`shows no member count and keeps submit open when the list read ${label}`, async () => {
            const target = mount('access-lists', {
                getTokenInfo: vi.fn().mockResolvedValue({
                    chainId: CHAIN, tick: 'TOKEN', creator: SOURCE.address, locks: {}, allowList: '42', blockList: null,
                }),
                getListByActionIndex: vi.fn(read),
                getListsForSource: vi.fn().mockResolvedValue([{ action_index: '55', type: '2', block_index: 1 }]),
            });
            expect(await screen.findByText(/List #42/)).toBeInTheDocument();
            await act(async () => { await Promise.resolve(); await Promise.resolve(); });
            expect(screen.queryByText(/0 members/)).toBeNull();

            fireEvent.click(screen.getByRole('button', { name: /Choose block-list/ }));
            fireEvent.click(await screen.findByText(/Address list #55/));
            const preview = await screen.findByRole('button', { name: 'Preview' });
            await waitFor(() => expect(preview).toBeEnabled());
            fireEvent.click(preview);
            fireEvent.submit(await screen.findByRole('form', { name: /Review/ }));
            await waitFor(() => expect(target.buildActionPsbtRequest).toHaveBeenCalledTimes(1));
            const params = target.buildActionPsbtRequest.mock.calls[0][0].actionData.params;
            expect(params.BLOCK_LIST).toBe('55');
            expect(params.ALLOW_LIST).toBeUndefined();
        });
    }
});

describe('TokenAdminForm address read fault', () => {
    it('shows the load error and assumes no owner address', async () => {
        const target = mount('access-lists', {
            getAddressesByChain: vi.fn().mockRejectedValue(new Error('Vault read failed.')),
        });
        expect(await screen.findByText('Vault read failed.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
        expect(screen.queryByText(SOURCE.address)).toBeNull();
        expect(screen.queryByDisplayValue(SOURCE.address)).toBeNull();
        expect(target.buildActionPsbtRequest).not.toHaveBeenCalled();
    });
});

describe('TokenAdminForm double press', () => {
    it('composes one action for a double press of submit', async () => {
        const compose = deferred();
        const target = mount('description', {
            buildActionPsbtRequest: vi.fn(() => compose.promise),
        });
        fireEvent.change(await screen.findByLabelText('New description'), {
            target: { value: 'One update' },
        });
        const preview = screen.getByRole('button', { name: 'Preview' });
        await waitFor(() => expect(preview).toBeEnabled());
        fireEvent.click(preview);
        const review = await screen.findByRole('form', { name: /Review/ });
        fireEvent.submit(review);
        fireEvent.submit(review);
        await act(async () => {
            compose.resolve({ psbtHex: '70736274ff00', chainId: CHAIN });
            await compose.promise;
        });
        expect(target.buildActionPsbtRequest).toHaveBeenCalledTimes(1);
    });

    it('runs one review for a double press while the owner re-read is pending', async () => {
        const fresh = deferred();
        const getTokenInfo = vi.fn((req) => (req?.fresh
            ? fresh.promise
            : Promise.resolve({ chainId: CHAIN, tick: 'TOKEN', creator: SOURCE.address, locks: {} })));
        mount('description', { getTokenInfo });
        fireEvent.change(await screen.findByLabelText('New description'), {
            target: { value: 'One update' },
        });
        const preview = screen.getByRole('button', { name: 'Preview' });
        await waitFor(() => expect(preview).toBeEnabled());
        fireEvent.click(preview);
        fireEvent.click(preview);
        await act(async () => {
            fresh.resolve({ chainId: CHAIN, tick: 'TOKEN', creator: SOURCE.address, locks: {} });
            await fresh.promise;
        });
        expect(getTokenInfo.mock.calls.filter(([req]) => req?.fresh)).toHaveLength(1);
        expect(await screen.findByRole('form', { name: /Review/ })).toBeInTheDocument();
    });
});
