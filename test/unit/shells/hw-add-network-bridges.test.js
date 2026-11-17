// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Add network on a hardware wallet, end to end through each shell's real
// signer bridge: the host route (`wallet.activateChain` with signerId and
// accountId) builds a RemoteSigner on the bridge transport, the renderer's
// session signer opens the Ledger through the app open now, and the address
// lands in that one account with the network's identity recorded. The
// extension popup and desktop bridges carry only an error's name and
// message across their port, so a wrong-app answer must still be recognised
// there: it comes back as a wait, never a failure. Add account keeps the
// networks left waiting in its answer.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useHardwareReconnect } from '../../../packages/core/src/shared/hooks/useHardwareSessionReset.js';
import * as core from '@xchain-wallet/core';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import * as bgSignerBridge from '../../../packages/extension/src/background/signerBridge.js';
import * as webBridge from '../../../packages/web/src/signerBridge.js';
import * as popupBridge from '../../../packages/extension/src/popup/signerBridge.js';
import * as desktopBridge from '../../../packages/desktop/renderer/signerBridge.js';
import { createBackgroundTransport } from '../../../packages/core/src/signers/signerPortProtocol.js';
import {
    _resetHardwareReconnectForTests, invalidateLiveSigners, setHardwareFactories,
} from '../../../packages/core/src/signers/hardwareReconnect.js';
import { ledgerIdentityFingerprint } from '../../../packages/core/src/signers/ledgerIdentity.js';
import { cancel, subscribe } from '../../../packages/core/src/signers/hardwareSession.js';
import { addHardwareWallet } from '../../../packages/core/src/flows/hardwareWallet.js';
import { listSignersForWallet } from '../../../packages/core/src/flows/registerSigner.js';
import { ensureSettings } from '../../../packages/core/src/flows/seedSettings.js';
import { makeLedgerFactory } from '../../../packages/core/src/signerFactories/ledger.js';
import { InMemoryBackend, Vault } from '../../../packages/core/src/storage/index.js';
import { SEED_A, SEED_B, seededLedger } from '../../helpers/hwSeedDevice.js';

const chainRegistry = core.registry.defaultRegistry();
const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const DOGE = 'dogecoin-mainnet';

/** The shell's Ledger factory, holding `mnemonic` with `openApp` open. */
function useLedger(openApp, mnemonic = SEED_A) {
    const dev = seededLedger(mnemonic, { openApp });
    const factory = vi.fn(makeLedgerFactory({
        getTransport: async () => dev.transport,
        getAppClass: async () => dev.Btc,
    }));
    setHardwareFactories({ ledger: factory, trezor: null });
    return { dev, factory };
}

/** A Ledger wallet connected with only its Bitcoin app read: accounts 1 and 2. */
async function bitcoinOnlyLedgerWallet() {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(7) });
    await vault.open();
    const dev = seededLedger(SEED_A, { openApp: 'Bitcoin' });
    const { signer, pairingInfo } = await makeLedgerFactory({
        getTransport: async () => dev.transport,
        getAppClass: async () => dev.Btc,
    })();
    const accounts = [];
    for (const accountIndex of [0, 1]) {
        // eslint-disable-next-line no-await-in-loop
        const [derived] = await signer.getAddresses({
            chainId: BTC, addressType: 'p2wpkh', accountIndex, change: 0, startIndex: 0, count: 1,
        });
        accounts.push({
            chainId: BTC, accountIndex, address: derived.address, publicKey: derived.publicKey, derivationPath: derived.path, addressType: 'p2wpkh',
        });
    }
    const hw = await addHardwareWallet({
        vault,
        chainRegistry,
        name: 'Desk Ledger',
        device: {
            vendor: 'ledger', model: pairingInfo.model, deviceIdentifier: pairingInfo.deviceIdentifier, firmwareVersion: pairingInfo.firmwareVersion,
        },
        accounts,
    });
    await ensureSettings(vault, chainRegistry, [BTC]);
    const [record] = await listSignersForWallet(vault, hw.wallet.id, { withIdentities: true });
    const walletAccounts = (await vault.accounts.findBy('walletId', hw.wallet.id)).sort((a, b) => a.index - b.index);
    return { vault, hw, record, walletAccounts };
}

function makeHost(vault) {
    return createBackgroundHost({
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        vault,
        chainRegistry,
        sdkRegistry: { get: () => ({}) },
    });
}

/** Two ends of one port; each message is copied as a structured clone would be. */
function linkedPorts() {
    const sides = { renderer: new Set(), background: new Set() };
    const end = (self, other) => ({
        postMessage: (msg) => {
            const copy = JSON.parse(JSON.stringify(msg));
            queueMicrotask(() => { for (const fn of [...sides[other]]) fn(copy); });
        },
        onMessage: {
            addListener: (fn) => sides[self].add(fn),
            removeListener: (fn) => sides[self].delete(fn),
        },
        onDisconnect: { addListener() {}, removeListener() {} },
    });
    return { renderer: end('renderer', 'background'), background: end('background', 'renderer') };
}

const SHELLS = [
    ['web', (record) => {
        webBridge.registerHardwareRecord(record);
    }],
    ['extension popup', (record) => {
        const ports = linkedPorts();
        vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => ports.renderer) } });
        bgSignerBridge.setTransport(record.id, createBackgroundTransport(ports.background));
        popupBridge.registerHardwareRecord(record);
    }],
    ['desktop', (record) => {
        const ports = linkedPorts();
        globalThis.xchainWalletSignerBridge = {
            postMessage: (msg) => ports.renderer.postMessage(msg),
            onMessage: (fn) => {
                ports.renderer.onMessage.addListener(fn);
                return () => ports.renderer.onMessage.removeListener(fn);
            },
        };
        bgSignerBridge.setTransport(record.id, createBackgroundTransport(ports.background));
        desktopBridge.registerHardwareRecord(record);
    }],
];

let current = null;

beforeEach(() => {
    _resetHardwareReconnectForTests();
    bgSignerBridge.clearAll();
});

afterEach(() => {
    if (current) webBridge.unregisterSigner(current.id);
    current = null;
    popupBridge._resetForTests();
    desktopBridge._resetForTests();
    bgSignerBridge.clearAll();
    delete globalThis.xchainWalletSignerBridge;
    vi.unstubAllGlobals();
    _resetHardwareReconnectForTests();
});

describe.each(SHELLS)('%s bridge: Add network on a Ledger account', (_name, connect) => {
    it('reads the network through the open app into that one account and records its identity', async () => {
        const { vault, hw, record, walletAccounts } = await bitcoinOnlyLedgerWallet();
        current = record;
        useLedger('Litecoin');
        connect(record);
        const host = makeHost(vault);

        const res = await host.handle({
            type: 'wallet.activateChain',
            request: { walletId: hw.wallet.id, chainId: LTC, signerId: record.id, accountId: walletAccounts[1].id },
        });
        expect(res.error).toBeUndefined();
        expect(res.ok).toBe(true);
        expect(res.result.hardwareSkipped).toBeUndefined();
        expect(res.result.addresses).toHaveLength(1);
        const { accountId, address } = res.result.addresses[0];
        expect(accountId).toBe(walletAccounts[1].id);
        expect(address.derivationPath).toBe("m/84'/2'/1'/0/0");

        const stored = await vault.signers.get(record.id);
        expect(stored.identities[LTC]).toEqual({
            path: address.derivationPath,
            fingerprint: ledgerIdentityFingerprint(address.publicKey),
        });
        const listed = await host.handle({ type: 'signer.list', request: { walletId: hw.wallet.id } });
        expect(listed.result[0].identities[LTC]).toEqual(stored.identities[LTC]);

        // A sign on the network it added is checked against that identity.
        invalidateLiveSigners();
        const transport = bgSignerBridge.getTransport(record.id);
        await expect(transport({
            op: 'signMessage',
            payload: { signerId: record.id, message: 'hi', path: address.derivationPath, chainId: LTC },
        })).resolves.toHaveProperty('signature');
        invalidateLiveSigners();
        useLedger('Litecoin', SEED_B);
        await expect(transport({
            op: 'signMessage',
            payload: { signerId: record.id, message: 'hi', path: address.derivationPath, chainId: LTC },
        })).rejects.toThrow(/different hardware wallet/);
    });

    it('answers another open app as a wait the page can show with Try again', async () => {
        const { vault, hw, record, walletAccounts } = await bitcoinOnlyLedgerWallet();
        current = record;
        useLedger('Bitcoin');
        connect(record);
        const host = makeHost(vault);

        const res = await host.handle({
            type: 'wallet.activateChain',
            request: { walletId: hw.wallet.id, chainId: LTC, signerId: record.id, accountId: walletAccounts[0].id },
        });
        expect(res.ok).toBe(true);
        expect(res.result).toMatchObject({ addresses: [], hardwareSkipped: 'wrong-app' });

        // Try again with the Litecoin app open now.
        useLedger('Litecoin');
        const again = await host.handle({
            type: 'wallet.activateChain',
            request: { walletId: hw.wallet.id, chainId: LTC, signerId: record.id, accountId: walletAccounts[0].id },
        });
        expect(again.result.addresses).toHaveLength(1);
    });

    it('a sign on a network the record has no identity for, with its app open, never shows a wrong-app failure', async () => {
        const { record } = await bitcoinOnlyLedgerWallet();
        current = record;
        useLedger('Litecoin');
        connect(record);
        const failures = [];
        const off = subscribe((event) => {
            if (event.type !== 'fail') return;
            failures.push(event.op.failure);
            cancel(event.op.opId);
        });
        try {
            await expect(bgSignerBridge.getTransport(record.id)({
                op: 'signMessage',
                payload: { signerId: record.id, message: 'hi', path: "m/84'/2'/0'/0/0", chainId: LTC },
            })).resolves.toHaveProperty('signature');
        } finally {
            off();
        }
        expect(failures).toEqual([]);
    });

    it('Add account answers the networks left waiting for their app', async () => {
        const { vault, hw, record } = await bitcoinOnlyLedgerWallet();
        current = record;
        useLedger('Litecoin');
        connect(record);
        const host = makeHost(vault);

        const res = await host.handle({
            type: 'account.create',
            request: { walletId: hw.wallet.id, signerId: record.id, activeChainIds: [BTC, LTC, DOGE] },
        });
        expect(res.ok).toBe(true);
        expect(res.result.waitingChains).toEqual([BTC, DOGE]);
        expect(res.result.addresses.map((entry) => entry.chainId)).toEqual([LTC]);
        expect((await vault.signers.get(record.id)).identities[LTC]).toBeTruthy();
    });
});

describe('a sign on a network the bridge copy of the record predates', () => {
    it('useHardwareReconnect gives the session the shell\'s signer list to read the record again, so the sign goes through', async () => {
        const { vault, hw, record, walletAccounts } = await bitcoinOnlyLedgerWallet();
        current = record;
        useLedger('Litecoin');
        // The bridge took its copy before Litecoin was added.
        webBridge.registerHardwareRecord(record);
        const host = makeHost(vault);
        const added = await host.handle({
            type: 'wallet.activateChain',
            request: { walletId: hw.wallet.id, chainId: LTC, signerId: record.id, accountId: walletAccounts[0].id },
        });
        const { derivationPath } = added.result.addresses[0].address;
        // A fresh session for the same record, as after a reload of the page.
        webBridge.unregisterSigner(record.id);
        webBridge.registerHardwareRecord(record);

        const listSigners = vi.fn(async (walletId) => (await host.handle({ type: 'signer.list', request: { walletId } })).result);
        const hook = renderHook(() => useHardwareReconnect({
            unlocked: true, walletId: hw.wallet.id, listSigners, registerRecord: () => {},
        }));
        await waitFor(() => expect(listSigners).toHaveBeenCalled());
        listSigners.mockClear();

        invalidateLiveSigners();
        await expect(bgSignerBridge.getTransport(record.id)({
            op: 'signMessage',
            payload: { signerId: record.id, message: 'hi', path: derivationPath, chainId: LTC },
        })).resolves.toHaveProperty('signature');
        expect(listSigners).toHaveBeenCalledWith(hw.wallet.id);
        hook.unmount();
    });
});

describe('each shell carries Add network to the host unchanged', () => {
    it.each([
        ['web', 'packages/web/src/messaging.js'],
        ['extension', 'packages/extension/src/popup/messaging.js'],
        ['desktop', 'packages/desktop/renderer/messaging.js'],
    ])('%s activateChainRequest forwards every field, accountId and signerId included', (_name, rel) => {
        const src = readFileSync(rel, 'utf8');
        expect(src).toMatch(/export function activateChainRequest\(opts\) \{\s+return \/\*\* @type \{any\} \*\/ \(sendMessage\('wallet\.activateChain', opts\)\);/);
        expect(src).toMatch(/sendMessage\('account\.create', opts\)/);
    });

    it('the host route passes accountId to the flow and Add account keeps waitingChains', () => {
        const src = readFileSync('packages/extension/src/background/createBackgroundHost.js', 'utf8');
        expect(src).toMatch(/host\.register\('wallet\.activateChain'[\s\S]*?accountId: typeof req\?\.accountId === 'string'/);
        expect(src).toMatch(/waitingChains: \[\.\.\.r\.waitingChains\]/);
    });
});
