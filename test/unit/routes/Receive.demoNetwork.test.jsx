// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// xchain-wallet#78: demo mode showed a regtest `bcrt1` address on Receive,
// and App Review is sent to demo mode first. A demo wallet now lands on
// mainnet, and Receive shows the address of whichever network is active.
//
// This drives the real import flow, the real host routes and the real
// Receive route, with only the address encoding faked (per chain, so the
// prefix proves which network's record Receive picked). Every shell reloads
// after a network switch, so each switch mounts Receive fresh, the way the
// app does.

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import { importMnemonic } from '../../../packages/core/src/flows/importMnemonic.js';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });
vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async (value) => `data:image/png;base64,${value}`) },
}));

// The chain list and network Onboarding's "Try in demo mode" passes.
const DEMO_CHAIN_IDS = [
    'bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet',
    'bitcoin-testnet', 'litecoin-testnet', 'dogecoin-testnet',
    'bitcoin-regtest', 'litecoin-regtest', 'dogecoin-regtest',
];

// Real-world leading characters per chain. Testnet and regtest DOGE share
// `n`, so the LTC and DOGE checks also read the shown record's own network.
const PREFIX = {
    'bitcoin-mainnet': 'bc1q',
    'bitcoin-testnet': 'tb1q',
    'bitcoin-regtest': 'bcrt1q',
    'litecoin-mainnet': 'ltc1q',
    'litecoin-testnet': 'tltc1q',
    'litecoin-regtest': 'rltc1q',
    'dogecoin-mainnet': 'D',
    'dogecoin-testnet': 'n',
    'dogecoin-regtest': 'n',
};

const LOW_COST_KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

async function demoWalletFixture() {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(9) });
    await vault.open();
    const chainRegistry = new ChainRegistry();
    const getHistory = vi.fn(async () => []);
    const sdkRegistry = {
        get: (chainId) => ({
            wallet: { deriveAddress: (publicKey) => `${PREFIX[chainId]}${publicKey.slice(2, 18)}` },
            explorer: { getHistory },
        }),
    };
    const { wallet } = await importMnemonic({
        password: 'demo-auto-password',
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        vault,
        chainRegistry,
        sdkRegistry,
        name: 'Demo Wallet',
        origin: 'demo',
        activeChainIds: DEMO_CHAIN_IDS,
        activeNetwork: 'mainnet',
        kdfParams: LOW_COST_KDF_PARAMS,
    });
    const host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry,
        signerPool: { get: () => null, has: () => false },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    const request = async (type, payload) => {
        const response = await host.handle({ type, request: payload });
        if (!response.ok) throw Object.assign(new Error(response.error?.message), response.error);
        return response.result;
    };
    const getAddressHistory = vi.fn((payload) => request('history.address', payload));
    const messaging = {
        setActiveNetwork: (payload) => request('settings.setActiveNetwork', payload),
        getSettings: () => request('settings.get'),
        getAddressesByChain: (walletId, accountId) => request('addresses.byChain', { walletId, accountId }),
        getNewestAddress: (walletId, chainId, accountId) => request('addresses.newest', { walletId, chainId, accountId }),
        getAddressHistory,
    };
    return { vault, walletId: wallet.id, messaging, getAddressHistory, getHistory };
}

const ADDRESS_PATTERN = /^(bc1q|tb1q|bcrt1q|ltc1q|tltc1q|rltc1q|D|n)[0-9a-f]{16}$/;

// Mount Receive the way the app does after a reload, and read the address
// it settles on.
async function shownAddress(messaging, walletId, chainId) {
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Receive walletId={walletId} prefill={chainId ? { chainId } : null} />
        </MessagingProvider>,
    );
    const node = await screen.findByText(ADDRESS_PATTERN);
    const value = node.textContent;
    view.unmount();
    return value;
}

let fixture;

beforeAll(async () => {
    fixture = await demoWalletFixture();
});

afterEach(() => {
    cleanup();
    clearDemoWalletId();
});

describe('demo wallet network (xchain-wallet#78)', () => {
    it('lands on mainnet with its testnet and regtest chains still registered', async () => {
        const settings = await fixture.vault.settings.get();
        expect(settings.activeNetwork).toBe('mainnet');
        const registered = new Set(
            (await fixture.vault.addresses.list()).map((a) => `${a.chain}-${a.network}`),
        );
        for (const chainId of DEMO_CHAIN_IDS) expect(registered.has(chainId)).toBe(true);
    });

    it('Receive shows a mainnet address first, then follows every network switch', async () => {
        const { messaging, walletId, vault } = fixture;
        markDemoWallet(walletId);

        expect(await shownAddress(messaging, walletId)).toMatch(/^bc1q/);

        const steps = [['testnet', /^tb1q/], ['regtest', /^bcrt1q/], ['mainnet', /^bc1q/]];
        for (const [network, btcPrefix] of steps) {
            // eslint-disable-next-line no-await-in-loop -- each switch is the step under test
            await messaging.setActiveNetwork({ walletId, network });
            // eslint-disable-next-line no-await-in-loop
            expect(Object.keys(await messaging.getAddressesByChain(walletId)).sort()).toEqual(
                [`bitcoin-${network}`, `dogecoin-${network}`, `litecoin-${network}`],
            );
            // eslint-disable-next-line no-await-in-loop
            expect(await shownAddress(messaging, walletId)).toMatch(btcPrefix);
            for (const coin of ['litecoin', 'dogecoin']) {
                const chainId = `${coin}-${network}`;
                // eslint-disable-next-line no-await-in-loop
                const shown = await shownAddress(messaging, walletId, chainId);
                expect(shown.startsWith(PREFIX[chainId])).toBe(true);
                // eslint-disable-next-line no-await-in-loop
                const holders = (await vault.addresses.list()).filter((a) => a.address === shown);
                expect(holders.map((a) => a.network)).toContain(network);
            }
        }
    });

    it('Receive never sends a demo address to the explorer', async () => {
        const { messaging, walletId, getAddressHistory, getHistory } = fixture;
        markDemoWallet(walletId);
        getAddressHistory.mockClear();
        getHistory.mockClear();
        expect(await shownAddress(messaging, walletId)).toMatch(/^bc1q/);
        expect(getAddressHistory).not.toHaveBeenCalled();
        expect(getHistory).not.toHaveBeenCalled();
    });
});
