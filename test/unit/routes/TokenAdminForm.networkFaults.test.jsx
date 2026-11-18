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
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
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

// The standard's action labels are Title Case.
const ADMIN_ACTION_PATTERN = /^(Lock Token|Update Description|Transfer Ownership|Update Mint Settings|Update Callback Settings|Update Access Lists|Update Bridge Settings)$/;
const adminAction = () => screen.getByRole('button', { name: ADMIN_ACTION_PATTERN });

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function mount(mode, overrides = {}, { initialTick = 'TOKEN', lockedTokenProps = true } = {}) {
    // The wallet's mode is read from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'w', walletMode: 'watcher' }], activeWalletId: 'w' });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({}),
        listWallets: vi.fn().mockResolvedValue([{ id: 'w', name: 'W', walletMode: 'watcher' }]),
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
    resetWalletModes();
    __clearTokenInfoCache();
});

describe('TokenAdminForm token record read faults', () => {
    it('explains a failed owner lookup and retries it from the notice', async () => {
        const getTokenInfo = vi.fn()
            .mockRejectedValueOnce(new Error('explorer unreachable'))
            .mockResolvedValueOnce({
                chainId: CHAIN, tick: 'TOKEN', creator: SOURCE.address, locks: {},
            });
        mount('description', { getTokenInfo });

        expect(await screen.findByText(/issuer could not be confirmed/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByText(/issuer could not be confirmed/i)).toBeNull());
        expect(adminAction()).not.toHaveAttribute('aria-disabled');
    });

    for (const mode of ['lock', 'access-lists']) {
        it(`keeps ${mode} closed and composes nothing when the token read fails`, async () => {
            const target = mount(mode, {
                getTokenInfo: vi.fn().mockRejectedValue(new Error('explorer unreachable')),
            });
            const preview = await screen.findByRole('button', { name: ADMIN_ACTION_PATTERN });
            await act(async () => { await Promise.resolve(); });
            expect(preview).toBeEnabled();
            fireEvent.click(preview);
            expect(screen.queryByTestId('confirm-modal')).toBeNull();
            expect(target.buildActionPsbtRequest).not.toHaveBeenCalled();
        });

        it(`keeps ${mode} closed and composes nothing while the token read never settles`, async () => {
            const target = mount(mode, {
                getTokenInfo: vi.fn(() => new Promise(() => {})),
            });
            const preview = await screen.findByRole('button', { name: ADMIN_ACTION_PATTERN });
            expect(preview).toBeEnabled();
            fireEvent.submit(preview.closest('form'));
            expect(screen.queryByTestId('confirm-modal')).toBeNull();
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

        const preview = adminAction();
        if (!preview.disabled) {
            fireEvent.click(preview);
            const approve = await screen.findByTestId('confirm-approve').catch(() => null);
            if (approve) {
                await waitFor(() => expect(approve).toBeEnabled());
                fireEvent.click(approve);
            }
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
        fireEvent.click(screen.getByRole('button', { name: /^Block list:/ }));
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
        expect(screen.getByRole('button', { name: 'Allow list: None set' })).toBeInTheDocument();
        expect(screen.queryByText(/List #5\b/)).toBeNull();
        expect(screen.queryByText(/List #7\b/)).toBeNull();
        expect(screen.queryByText(/List #55/)).toBeNull();

        // Unchanged against the second token's record: the action stays
        // enabled (G22) and a press says nothing changed instead of composing.
        const preview = adminAction();
        expect(preview).not.toBeDisabled();
        fireEvent.click(preview);
        expect((await screen.findAllByText(/Leaving both unchanged does nothing/)).length).toBeGreaterThan(0);
        expect(target.buildActionPsbtRequest).not.toHaveBeenCalled();

        // A new allow-list composes only that change; the block-list matches
        // the second token's record and is left out.
        fireEvent.click(screen.getByRole('button', { name: /^Allow list: None set/ }));
        fireEvent.click(await screen.findByText(/Address list #55/));
        const openPreview = await screen.findByRole('button', { name: ADMIN_ACTION_PATTERN });
        await waitFor(() => expect(openPreview).toBeEnabled());
        fireEvent.click(openPreview);
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
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
        const maxSupply = await screen.findByRole('switch', { name: /Max supply \(already locked\)/ });
        expect(maxSupply).toBeChecked();
        expect(maxSupply).toBeDisabled();
        const maxMint = screen.getByRole('switch', { name: /^Max mint per transaction/ });
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

            fireEvent.click(screen.getByRole('button', { name: /^Block list: None set/ }));
            fireEvent.click(await screen.findByText(/Address list #55/));
            const preview = await screen.findByRole('button', { name: ADMIN_ACTION_PATTERN });
            await waitFor(() => expect(preview).toBeEnabled());
            fireEvent.click(preview);
            const approve = await screen.findByTestId('confirm-approve');
            await waitFor(() => expect(approve).toBeEnabled());
            fireEvent.click(approve);
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
        expect(screen.queryByRole('button', { name: ADMIN_ACTION_PATTERN })).toBeNull();
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
        fireEvent.change(await screen.findByLabelText('Description'), {
            target: { value: 'One update' },
        });
        const preview = adminAction();
        await waitFor(() => expect(preview).toBeEnabled());
        fireEvent.click(preview);
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        fireEvent.click(approve);
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
        fireEvent.change(await screen.findByLabelText('Description'), {
            target: { value: 'One update' },
        });
        const preview = adminAction();
        await waitFor(() => expect(preview).toBeEnabled());
        fireEvent.click(preview);
        fireEvent.click(preview);
        await act(async () => {
            fresh.resolve({ chainId: CHAIN, tick: 'TOKEN', creator: SOURCE.address, locks: {} });
            await fresh.promise;
        });
        expect(getTokenInfo.mock.calls.filter(([req]) => req?.fresh)).toHaveLength(1);
        expect(await screen.findByTestId('confirm-modal')).toBeInTheDocument();
    });
});
