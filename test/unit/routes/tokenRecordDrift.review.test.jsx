// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A token form reads the token record when it opens. When the token changes
// before the user presses Review (a lock, a pause lock, a sale of the name, a
// settings edit from another tab), Review re-reads the record and stops with
// a sentence instead of composing against the old copy.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MintForm } from '../../../packages/core/src/shared/routes/MintForm.jsx';
import { SleepForm } from '../../../packages/core/src/shared/routes/SleepForm.jsx';
import { SellOwnershipForm } from '../../../packages/core/src/shared/routes/SellOwnershipForm.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import {
    tokenRecordsDiffer,
    tokenRecordChangedSince,
} from '../../../packages/core/src/shared/utils/tokenRecordDrift.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const SLEEP_ADDRESS = { ...ADDRESS, address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu' };
const OTHER_OWNER = 'bc1q9d4ywgfnd8h43da5tpcxcn6ytpx4rstuq6u2dq';
const CHANGED = /changed since this form opened/;

function baseMessaging(extra = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        listContacts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        composeForConfirm: vi.fn(() => new Promise(() => {})),
        preflight: vi.fn(),
        ...extra,
    };
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('tokenRecordsDiffer', () => {
    it('compares locks by the flags that are set', () => {
        expect(tokenRecordsDiffer({ locks: { mint: false } }, { locks: {} })).toBe(false);
        expect(tokenRecordsDiffer({ locks: {} }, { locks: { mint: true } })).toBe(true);
    });

    it('treats a missing record as no difference', () => {
        expect(tokenRecordsDiffer(null, { locks: { mint: true } })).toBe(false);
        expect(tokenRecordsDiffer({ locks: {} }, undefined)).toBe(false);
    });

    it('ignores fields outside the watched keys', () => {
        expect(tokenRecordsDiffer({ totalSupply: '1' }, { totalSupply: '2' })).toBe(false);
        expect(tokenRecordsDiffer({ totalSupply: '1' }, { totalSupply: '2' }, ['totalSupply'])).toBe(true);
    });

    it('reports no change when the re-read fails', async () => {
        const messaging = { getTokenInfo: vi.fn().mockRejectedValue(new Error('explorer down')) };
        await expect(tokenRecordChangedSince({
            messaging, chainId: CHAIN, tick: 'T', current: { locks: {} },
        })).resolves.toBe(false);
    });
});

describe('Review re-reads the token', () => {
    it('Mint stops when LOCK_MINT lands after the form opened', async () => {
        const getTokenInfo = vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: 'TOK', locks: {}, maxSupply: '5000', totalSupply: '1', divisibility: 0,
        });
        const messaging = baseMessaging({ getTokenInfo });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MintForm walletId="w" initialChainId={CHAIN} initialTick="TOK" onBack={() => {}} />
            </MessagingProvider>,
        );
        await screen.findByText(/available to mint/);
        getTokenInfo.mockResolvedValue({
            chainId: CHAIN, tick: 'TOK', locks: { mint: true }, maxSupply: '5000', totalSupply: '1', divisibility: 0,
        });
        fireEvent.change(await screen.findByLabelText(/^Amount\b/), { target: { value: '10' } });
        fireEvent.click(screen.getByRole('button', { name: /^(Mint|Preview)$/ }));

        expect(await screen.findByRole('alert')).toHaveTextContent(CHANGED);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('Mint goes through when the token did not move', async () => {
        const messaging = baseMessaging({
            getTokenInfo: vi.fn().mockResolvedValue({
                chainId: CHAIN, tick: 'TOK', locks: {}, maxSupply: '5000', totalSupply: '1', divisibility: 0,
            }),
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MintForm walletId="w" initialChainId={CHAIN} initialTick="TOK" onBack={() => {}} />
            </MessagingProvider>,
        );
        await screen.findByText(/available to mint/);
        fireEvent.change(await screen.findByLabelText(/^Amount\b/), { target: { value: '10' } });
        fireEvent.click(screen.getByRole('button', { name: /^(Mint|Preview)$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
    });

    it('Pause token stops when LOCK_SLEEP lands after the form opened', async () => {
        const getTokenInfo = vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: 'gate', creator: SLEEP_ADDRESS.address, locks: {},
        });
        const messaging = baseMessaging({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SLEEP_ADDRESS] }),
            getTokenInfo,
            sleepState: vi.fn().mockResolvedValue({ resumeBlock: -1 }),
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SleepForm walletId="w" mode="tick" initialChainId={CHAIN} initialTick="gate" onBack={() => {}} />
            </MessagingProvider>,
        );
        await screen.findByText('gate is currently PAUSED indefinitely.');
        getTokenInfo.mockResolvedValue({
            chainId: CHAIN, tick: 'gate', creator: SLEEP_ADDRESS.address, locks: { sleep: true },
        });
        fireEvent.click(screen.getByRole('radio', { name: 'Resume now (unpause)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Resume token' }));

        expect(await screen.findByText(CHANGED)).toBeInTheDocument();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('Sell name stops when the name changed owner after the form opened', async () => {
        const getTokenInfo = vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: 'alpha', creator: ADDRESS.address, locks: {},
        });
        const messaging = baseMessaging({ getTokenInfo });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SellOwnershipForm walletId="w" chainId={CHAIN} tick="alpha" onBack={() => {}} />
            </MessagingProvider>,
        );
        const price = await screen.findByLabelText(/^Price/);
        const button = screen.getByRole('button', { name: 'List name for sale' });
        fireEvent.change(price, { target: { value: '5' } });
        await waitFor(() => expect(button).toBeEnabled());
        getTokenInfo.mockResolvedValue({
            chainId: CHAIN, tick: 'alpha', creator: OTHER_OWNER, locks: {},
        });
        fireEvent.click(button);

        expect(await screen.findByRole('alert')).toHaveTextContent(CHANGED);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('Mint settings does not write stale prefilled values back over a newer edit', async () => {
        const getTokenInfo = vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: 'TOKEN', creator: ADDRESS.address, locks: {}, mintMax: '100', divisibility: 0,
        });
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({ psbtHex: '70736274ff00', chainId: CHAIN });
        const messaging = baseMessaging({
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            getTokenInfo,
            buildActionPsbtRequest,
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenAdminForm
                    walletId="w"
                    mode="mint-settings"
                    initialChainId={CHAIN}
                    initialTick="TOKEN"
                    initialFromAddress={ADDRESS.address}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );
        const stop = await screen.findByLabelText(/Minting closes at block/i);
        await waitFor(() => expect(screen.getByLabelText(/Max mint per transaction/i)).toHaveValue('100'));
        // Another tab raised MAX_MINT while this form sat open.
        getTokenInfo.mockResolvedValue({
            chainId: CHAIN, tick: 'TOKEN', creator: ADDRESS.address, locks: {}, mintMax: '500', divisibility: 0,
        });
        fireEvent.change(stop, { target: { value: '900' } });
        const preview = screen.getByRole('button', { name: 'Preview' });
        await waitFor(() => expect(preview).toBeEnabled());
        fireEvent.click(preview);

        expect(await screen.findByRole('alert')).toHaveTextContent(CHANGED);
        expect(screen.queryByRole('form', { name: /Review/ })).toBeNull();
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });
});
