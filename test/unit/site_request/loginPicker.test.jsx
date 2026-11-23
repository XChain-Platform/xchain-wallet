// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react';
import { importMnemonic } from '../../../packages/core/src/flows/importMnemonic.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { createAddress } from '../../../packages/core/src/schemas/address.js';
import { createConnectedSite } from '../../../packages/core/src/schemas/connectedSite.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../packages/extension/src/bridge/handlers.js';

const mocks = vi.hoisted(() => ({
    listWallets: vi.fn(),
    resolveApproval: vi.fn(),
    getAddressBalances: vi.fn(),
    getAddressesByChain: vi.fn(),
    getSettings: vi.fn(),
    parsePsbt: vi.fn(),
    requoteNativeFee: vi.fn(),
    parseCoSign: vi.fn(),
    preflight: vi.fn(),
    describeAction: vi.fn(),
    getTokenInfo: vi.fn(),
}));

vi.mock('../../../packages/core/src/shared/approval/index.js', () => mocks);
vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/core/src/shared/approval/SignApproval.jsx'
);

const CHAIN_ID = 'bitcoin-regtest';
const ORIGIN = 'https://login-picker.example';
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TEST_UNLOCK_INPUT = 'login-picker-test-input';
const KDF = {
    algorithm: 'argon2id',
    salt: Buffer.alloc(16, 31).toString('base64'),
    iterations: 1,
    memory: 8192,
    parallelism: 1,
};

const chainRegistry = defaultRegistry();
const signMessage = vi.fn((message, _wif, options) => {
    if (options?.format !== 'bip322-simple') {
        throw new Error('local SDK stub requires the named BIP-322 option');
    }
    return { signature: `bip322:${message}` };
});
const sdkRegistry = {
    get: vi.fn(() => ({
        wallet: {
            deriveAddress: (publicKey, { type }) => `${type}_${publicKey.slice(0, 24)}`,
        },
        auth: { signMessage },
    })),
};

let vault;
let walletId;
let heldAddresses;

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

beforeAll(async () => {
    vault = new Vault({
        backend: new InMemoryBackend(),
        masterKey: new Uint8Array(32).fill(37),
        autoSave: false,
    });
    await vault.open();
    const imported = await importMnemonic({
        password: String(TEST_UNLOCK_INPUT),
        mnemonic: MNEMONIC,
        vault,
        chainRegistry,
        sdkRegistry,
        activeChainIds: [CHAIN_ID],
        name: 'Picker wallet',
        kdfParams: KDF,
    });
    walletId = imported.wallet.id;
    const accountId = imported.account.id;
    const descriptor = chainRegistry.get(CHAIN_ID);
    const publicKey = imported.addresses[0].address.publicKey;
    const records = [
        createAddress({
            accountId,
            chain: descriptor.coin,
            network: descriptor.networkKind,
            source: 'hd',
            addressType: 'p2pkh',
            derivationPath: "m/44'/1'/0'/0/0",
            address: 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn',
            publicKey,
            signerId: walletId,
        }),
        createAddress({
            accountId,
            chain: descriptor.coin,
            network: descriptor.networkKind,
            source: 'hd',
            addressType: 'p2sh-p2wpkh',
            derivationPath: "m/49'/1'/0'/0/0",
            address: '2NBFNJTktNa7GZusGbDbGKRZTxdK9VVez3n',
            publicKey,
            signerId: walletId,
        }),
        createAddress({
            accountId,
            chain: descriptor.coin,
            network: descriptor.networkKind,
            source: 'hd',
            addressType: 'p2tr',
            derivationPath: "m/86'/1'/0'/0/0",
            address: 'bcrt1pTaprootHeldAddress',
            publicKey,
            signerId: walletId,
        }),
        createAddress({
            accountId,
            chain: descriptor.coin,
            network: descriptor.networkKind,
            source: 'watch-only',
            addressType: 'p2wpkh',
            derivationPath: "m/84'/1'/0'/0/9",
            address: 'bcrt1qWatchOnlyAddress',
            publicKey,
        }),
    ];
    for (const record of records) await vault.addresses.put(record);
    heldAddresses = (await vault.addresses.list()).filter(({ source }) => source !== 'watch-only');
    await vault.connectedSites.put(createConnectedSite({
        origin: ORIGIN,
        appName: 'Picker integration test',
        permissions: {
            chains: [CHAIN_ID],
            accounts: [accountId],
            canSignMessage: false,
            canSignAction: {},
        },
    }));
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

afterAll(async () => {
    await vault?.close();
    vi.unstubAllGlobals();
});

describe('login address picker', () => {
    it('offers every held address and sends the Taproot pick through the production sign-in path', async () => {
        const requestReady = deferred();
        const decisionReady = deferred();
        const signIn = vi.fn((request) => {
            requestReady.resolve(request);
            return decisionReady.promise;
        });
        const host = new MessageHost({ vault, chainRegistry, sdkRegistry });
        registerBridgeHandlers(host, {
            approvals: { signIn },
            signThrottle: { check: () => ({ allowed: true }) },
        });
        const responsePromise = host.handle({
            type: 'bridge.signIn',
            request: {
                origin: ORIGIN,
                appId: 'login-picker-test',
                chainId: CHAIN_ID,
                nonce: 'picker-nonce',
            },
        });
        const approvalRequest = await requestReady.promise;

        vi.spyOn(window, 'close').mockImplementation(() => {});
        mocks.listWallets.mockImplementation(() => vault.wallets.list());
        mocks.getAddressesByChain.mockImplementation(async () => ({
            [CHAIN_ID]: await vault.addresses.list(),
        }));
        mocks.getSettings.mockResolvedValue({});
        mocks.resolveApproval.mockImplementation(async (_id, decision) => {
            decisionReady.resolve(decision);
            return { resolved: true };
        });
        mocks.getAddressBalances.mockRejectedValue(new Error('not used by sign-in'));
        mocks.parsePsbt.mockResolvedValue(null);
        mocks.requoteNativeFee.mockResolvedValue(null);
        mocks.parseCoSign.mockResolvedValue(null);
        mocks.preflight.mockResolvedValue({ verdict: 'pass', findings: [], unverified: [] });
        mocks.describeAction.mockResolvedValue(null);
        mocks.getTokenInfo.mockResolvedValue(null);

        render(
            <SignApproval
                id="login-picker"
                kind="signIn"
                payload={approvalRequest}
                onReject={() => {}}
            />,
        );

        const trigger = await screen.findByRole('button', { name: /Sign in as:/ });
        fireEvent.click(trigger);
        const picker = screen.getByRole('listbox', { name: 'Sign in as' });
        expect(within(picker).getAllByRole('option')).toHaveLength(heldAddresses.length);
        expect(within(picker).queryByRole('option', { name: /bcrt1qWatchOnlyAddress/ })).toBeNull();

        for (const { address } of heldAddresses) {
            expect(within(picker).getByRole('option', {
                name: new RegExp(`^${address}`),
            })).toBeInTheDocument();
        }
        const taproot = heldAddresses.find(({ addressType }) => addressType === 'p2tr');
        fireEvent.click(within(picker).getByRole('option', {
            name: new RegExp(`^${taproot.address}`),
        }));

        fireEvent.change(screen.getByLabelText('Password'), {
            target: { value: TEST_UNLOCK_INPUT },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

        await waitFor(() => expect(mocks.resolveApproval).toHaveBeenCalledWith(
            'login-picker',
            {
                approved: true,
                walletId,
                password: String(TEST_UNLOCK_INPUT),
                address: taproot.address,
                chainId: CHAIN_ID,
            },
        ));
        const response = await responsePromise;
        expect(response).toMatchObject({
            ok: true,
            result: {
                ok: true,
                address: taproot.address,
                chainId: CHAIN_ID,
                signature: expect.stringMatching(/^bip322:/),
            },
        });
        expect(signMessage).toHaveBeenCalledWith(
            response.result.challenge,
            expect.any(String),
            { format: 'bip322-simple' },
        );
    });
});
