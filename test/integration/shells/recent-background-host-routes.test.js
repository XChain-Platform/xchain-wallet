// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

const { submittedActions } = vi.hoisted(() => ({ submittedActions: [] }));
vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async (opts) => {
        submittedActions.push(opts);
        return { txid: 'feed-list-edit' };
    }),
}));

import { encryptWalletSeed, decryptWalletSeed } from '../../../packages/core/src/crypto/walletBlob.js';
import { makeFreshKdfParams } from '../../../packages/core/src/crypto/kdf.js';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { startLabelSyncRestoreTask } from '../../../packages/extension/src/background/labelSyncRestoreTasks.js';
import { createSendHold } from '../../../packages/extension/src/background/sendHold.js';

const CHAIN = 'bitcoin-regtest';
const SOURCE = 'bcrt1qsource';
const DESTINATION = 'bcrt1qdestination';
const ORIGINAL_TX = 'aa'.repeat(32);
const INPUT_TX = '11'.repeat(32);
const ALICE = `02${'aa'.repeat(32)}`;
const BOB = `03${'bb'.repeat(32)}`;

function collection(initial = []) {
    const rows = new Map(initial.map((row) => [row.id, structuredClone(row)]));
    return {
        async get(id) { return rows.has(id) ? structuredClone(rows.get(id)) : null; },
        async list() { return [...rows.values()].map((row) => structuredClone(row)); },
        async findBy(field, value) {
            return [...rows.values()]
                .filter((row) => row[field] === value)
                .map((row) => structuredClone(row));
        },
        async put(row) {
            rows.set(row.id, structuredClone(row));
            return row;
        },
        async count() { return rows.size; },
    };
}

function makeVault(overrides = {}) {
    return {
        wallets: collection(),
        accounts: collection(),
        addresses: collection(),
        contacts: collection(),
        connectedSites: collection(),
        pendingTxs: collection(),
        signers: collection(),
        settings: {
            async get() { return {}; },
            async put() {},
        },
        ...overrides,
    };
}

function makeHost(overrides = {}) {
    return createBackgroundHost({
        vault: makeVault(),
        chainRegistry: {
            get: () => null,
            list: () => [],
            supportedChains: () => [],
        },
        sdkRegistry: { get: () => ({}), for: () => ({}) },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        ...overrides,
    });
}

const call = (host, type, request) => host.handle({ type, request });

function vaultLockedError() {
    return Object.assign(new Error('wallet is locked'), { name: 'VaultLockedError' });
}

afterEach(() => {
    submittedActions.length = 0;
    vi.unstubAllGlobals();
});

describe('recent background host routes across extension, web, and desktop shells', () => {
    it('addresses.newest returns the latest derivable address and rejects invalid or locked reads', async () => {
        const newest = {
            id: 'address-watch-8',
            accountId: 'account-1',
            chain: 'bitcoin',
            network: 'regtest',
            address: 'bcrt1qwatch8',
            addressType: 'p2wpkh',
            source: 'watch-only',
            derivationPath: "m/84'/1'/0'/0/8",
        };
        const vault = makeVault({
            accounts: collection([{ id: 'account-1', walletId: 'wallet-1' }]),
            addresses: collection([
                {
                    ...newest,
                    id: 'address-hd-7',
                    address: 'bcrt1qhd7',
                    source: 'hd',
                    derivationPath: "m/84'/1'/0'/0/7",
                },
                newest,
                {
                    ...newest,
                    id: 'address-imported-9',
                    address: 'bcrt1qimported9',
                    source: 'imported',
                    derivationPath: "m/84'/1'/0'/0/9",
                },
            ]),
        });
        const descriptor = { id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' };
        const registry = {
            get: (id) => id === CHAIN ? descriptor : null,
            list: () => [descriptor],
            supportedChains: () => [descriptor],
        };
        const host = makeHost({ vault, chainRegistry: registry });

        expect(await call(host, 'addresses.newest', {
            walletId: 'wallet-1',
            chainId: CHAIN,
            addressType: 'p2wpkh',
        })).toEqual({ ok: true, result: newest });
        const invalid = await call(host, 'addresses.newest', { walletId: 'wallet-1' });
        expect(invalid).toMatchObject({
            ok: false,
            error: { message: expect.stringContaining('chainId is required') },
        });

        const lockedHost = makeHost({
            vault: makeVault({
                accounts: { findBy: async () => { throw vaultLockedError(); } },
            }),
            chainRegistry: registry,
        });
        expect(await call(lockedHost, 'addresses.newest', {
            walletId: 'wallet-1',
            chainId: CHAIN,
            addressType: 'p2wpkh',
        })).toMatchObject({ ok: false, error: { name: 'VaultLockedError' } });
    });

    it('multisigSign.finalize returns the finalized session and rejects invalid or locked reads', async () => {
        const createdAt = '2026-10-13T12:00:00.000Z';
        const session = {
            schemaVersion: 1,
            id: 'session-1',
            walletId: 'wallet-1',
            chainId: CHAIN,
            scheme: 'p2wsh-multisig',
            threshold: 2,
            cosignerPubkeys: [ALICE, BOB],
            msgHash: 'ab'.repeat(32),
            psbtHex: '70736274ff',
            actionSummary: 'Send 0.01 BTC',
            nonces: [],
            aggNonce: null,
            partialSigs: [],
            aggregatedSchnorrSig: null,
            signatures: [],
            status: 'ready-to-finalize',
            finalizedTxHex: null,
            txid: null,
            createdAt,
            updatedAt: createdAt,
        };
        const sessions = collection([session]);
        const finalizeMultisigPsbt = vi.fn(async () => ({
            txHex: '02000000000100',
            txid: 'finalized-txid',
        }));
        const sdk = { wallet: { finalizeMultisigPsbt } };
        const host = makeHost({
            vault: makeVault({ multisigSigningSessions: sessions }),
            sdkRegistry: { get: () => sdk, for: () => sdk },
        });

        const accepted = await call(host, 'multisigSign.finalize', { sessionId: session.id });
        expect(accepted).toEqual({
            ok: true,
            result: {
                ...session,
                finalizedTxHex: '02000000000100',
                txid: 'finalized-txid',
                status: 'finalized',
                updatedAt: expect.any(String),
            },
        });
        expect(finalizeMultisigPsbt).toHaveBeenCalledWith(session.psbtHex);

        const invalid = await call(host, 'multisigSign.finalize', {});
        expect(invalid).toMatchObject({
            ok: false,
            error: { message: expect.stringContaining('sessionId is required') },
        });

        const lockedHost = makeHost({
            vault: makeVault({
                multisigSigningSessions: {
                    get: async () => { throw vaultLockedError(); },
                },
            }),
        });
        expect(await call(lockedHost, 'multisigSign.finalize', {
            sessionId: session.id,
        })).toMatchObject({ ok: false, error: { name: 'VaultLockedError' } });
    });

    it('wallet.labelSyncRestoreResult returns a task result and refuses a missing token', async () => {
        const host = makeHost();
        const token = startLabelSyncRestoreTask({
            walletId: 'wallet-1',
            run: async () => ({ restored: true }),
        });

        await expect(call(host, 'wallet.labelSyncRestoreResult', { token })).resolves.toEqual({
            ok: true,
            result: { restored: true },
        });
        expect((await call(host, 'wallet.labelSyncRestoreResult', {})).ok).toBe(false);
    });

    it('wallet.setActive announces an existing wallet and refuses an unknown wallet', async () => {
        const walletSwitched = vi.fn(async () => {});
        const vault = makeVault({
            wallets: collection([{ id: 'wallet-1' }]),
            accounts: collection([{ id: 'account-1', walletId: 'wallet-1', index: 0 }]),
            connectedSites: collection([{ id: 'site-1' }]),
        });
        const host = makeHost({ vault, bridgeEvents: { emit() {}, walletSwitched } });

        expect(await call(host, 'wallet.setActive', { walletId: 'wallet-1' })).toEqual({
            ok: true,
            result: { ok: true },
        });
        expect(walletSwitched).toHaveBeenCalledTimes(1);
        expect((await call(host, 'wallet.setActive', { walletId: 'missing' })).ok).toBe(false);
    });

    it('wallet.changePassword rekeys a wallet and refuses the previous password afterward', async () => {
        const mnemonic = new TextEncoder().encode(
            'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        );
        const sealed = await encryptWalletSeed({
            password: 'old-password',
            seed: mnemonic,
            kdfParams: makeFreshKdfParams({ iterations: 1, memory: 8 * 1024 }),
        });
        const wallets = collection([{
            id: 'wallet-1',
            name: 'Main',
            format: 'bip39',
            passphraseEnabled: false,
            importedKeys: [],
            ...sealed,
        }]);
        const evict = vi.fn();
        const host = makeHost({
            vault: makeVault({ wallets }),
            signerPool: { get: () => null, has: () => false, evict },
        });

        expect(await call(host, 'wallet.changePassword', {
            walletId: 'wallet-1',
            currentPassword: 'old-password',
            newPassword: 'new-password',
        })).toEqual({ ok: true, result: { changed: true } });
        expect(evict).toHaveBeenCalledWith('wallet-1');
        const changed = await wallets.get('wallet-1');
        const decrypted = await decryptWalletSeed({
            password: 'new-password',
            encryptedSeed: changed.encryptedSeed,
            kdfParams: changed.kdfParams,
        });
        expect([...decrypted]).toEqual([...mnemonic]);

        const refused = await call(host, 'wallet.changePassword', {
            walletId: 'wallet-1',
            currentPassword: 'old-password',
            newPassword: 'another-password',
        });
        expect(refused.ok).toBe(false);
    });

    it('diagnostic.dump returns a redacted shell snapshot and envelopes a registry refusal', async () => {
        const descriptor = {
            id: CHAIN,
            coin: 'bitcoin',
            networkKind: 'regtest',
            explorer: {},
            encoder: {},
            hub: {},
        };
        const host = makeHost({
            chainRegistry: {
                get: () => descriptor,
                list: () => [descriptor],
                supportedChains: () => [descriptor],
            },
            getDiagnosticContext: () => ({ env: { shell: 'desktop' } }),
        });

        const accepted = await call(host, 'diagnostic.dump', {
            recentErrors: [{ kind: 'TypeError', message: 'renderer failed' }],
        });
        expect(accepted.ok).toBe(true);
        expect(accepted.result.wallet.platform).toBe('desktop');
        expect(accepted.result.chains).toEqual([expect.objectContaining({ id: CHAIN })]);

        const refusingHost = makeHost({
            chainRegistry: {
                get: () => null,
                list: () => [],
                supportedChains() { throw new Error('registry unavailable'); },
            },
        });
        expect((await call(refusingHost, 'diagnostic.dump', {})).ok).toBe(false);
    });

    it('addresses.setHidden persists a boolean and refuses a non-boolean value', async () => {
        const addresses = collection([{ id: 'address-1', address: SOURCE, hidden: false }]);
        const host = makeHost({ vault: makeVault({ addresses }) });

        expect(await call(host, 'addresses.setHidden', {
            id: 'address-1', hidden: true,
        })).toEqual({ ok: true, result: { ok: true } });
        expect((await addresses.get('address-1')).hidden).toBe(true);
        expect((await call(host, 'addresses.setHidden', {
            id: 'address-1', hidden: 'yes',
        })).ok).toBe(false);
    });

    it('send.holdCancel cancels a held send and refuses an empty hold id', async () => {
        const sendHold = createSendHold();
        const host = makeHost({ sendHold });
        const held = sendHold.hold('hold-1', 60);

        expect(await call(host, 'send.holdCancel', { holdId: 'hold-1' })).toEqual({
            ok: true,
            result: { cancelled: true },
        });
        await expect(held).resolves.toBe('cancelled');
        expect((await call(host, 'send.holdCancel', { holdId: '' })).ok).toBe(false);
    });

    it('tx.replace previews an eligible replacement and refuses an unknown strategy', async () => {
        const descriptor = {
            id: CHAIN,
            coin: 'bitcoin',
            networkKind: 'regtest',
            displayName: 'Bitcoin Regtest',
            feeStrategy: { rbfSupported: true },
        };
        const transaction = {
            inputs: [{
                prevTxHash: INPUT_TX,
                prevTxIndex: 0,
                sequence: 0xfffffffd,
                value: 10000,
                scriptPubKeyHex: `0014${'22'.repeat(20)}`,
            }],
            outputs: [
                { address: DESTINATION, scriptType: 'p2wpkh', value: 7000 },
                { address: SOURCE, scriptType: 'p2wpkh', value: 2000 },
            ],
        };
        const vault = makeVault({
            wallets: collection([{ id: 'wallet-1', importedKeys: [] }]),
            accounts: collection([{ id: 'account-1', walletId: 'wallet-1' }]),
            addresses: collection([{
                id: 'address-1',
                accountId: 'account-1',
                address: SOURCE,
                publicKey: '02'.padEnd(66, '1'),
            }]),
            pendingTxs: collection([{
                id: 'pending-1',
                chain: 'bitcoin',
                network: 'regtest',
                fromAddress: SOURCE,
                toAddress: DESTINATION,
                txid: ORIGINAL_TX,
                psbtHex: 'original-psbt',
                txHex: '00'.repeat(250),
                status: 'broadcast',
                rbf: true,
            }]),
        });
        const sdk = {
            wallet: { decomposePsbt: () => transaction },
            encoder: { createTx: vi.fn(), broadcastTx: vi.fn() },
        };
        const host = makeHost({
            vault,
            chainRegistry: { get: () => descriptor, list: () => [descriptor], supportedChains: () => [descriptor] },
            sdkRegistry: { get: () => sdk, for: () => sdk },
        });
        const request = {
            chainId: CHAIN,
            walletId: 'wallet-1',
            originalTxHash: ORIGINAL_TX,
            strategy: 'speedup',
            preview: true,
        };

        expect(await call(host, 'tx.replace', request)).toEqual({
            ok: true,
            result: {
                originalFee: '0.00001',
                replacementFee: '0.00002',
                feeIncrease: '0.00001',
            },
        });
        expect((await call(host, 'tx.replace', { ...request, strategy: 'unknown' })).ok).toBe(false);
    });

    it('action.editBetFeedLists dispatches valid params and refuses an empty edit', async () => {
        const sdk = {
            actions: { createAction: vi.fn(() => ({ actionString: 'BET|4|42|81|' })) },
        };
        const signer = { kind: 'software' };
        const host = makeHost({
            chainRegistry: { get: () => ({ id: CHAIN }), list: () => [], supportedChains: () => [] },
            sdkRegistry: { get: () => sdk, for: () => sdk },
            signerPool: { get: () => signer, has: () => true },
        });
        const request = {
            chainId: CHAIN,
            walletId: 'wallet-1',
            from: { address: SOURCE, publicKey: '02aabbcc', derivationPath: "m/84'/1'/0'/0/0" },
            params: { feedActionIndex: 42, allowList: 81, blockList: '' },
            trackPendingTx: false,
        };

        expect(await call(host, 'action.editBetFeedLists', request)).toEqual({
            ok: true,
            result: { txid: 'feed-list-edit' },
        });
        expect(submittedActions).toHaveLength(1);
        expect(submittedActions[0]).toMatchObject({ chainId: CHAIN, signer });
        expect((await call(host, 'action.editBetFeedLists', {
            ...request,
            params: { feedActionIndex: 42 },
        })).ok).toBe(false);
    });

    it('action.bet.psbt builds an unsigned transaction and refuses an unknown builder', async () => {
        const descriptor = { id: CHAIN, feeStrategy: { rbfSupported: true } };
        const sdk = {
            betting: {
                cancelMarketParams: (params) => ({ version: 1, ...params }),
            },
            actions: {
                createAction: ({ params }) => ({
                    action: 'BET', version: params.version, actionString: 'BET|1|42',
                }),
            },
            encoder: {
                createTx: vi.fn(async () => ({ psbt: '70736274ff00', encoding: 'OP_RETURN' })),
            },
        };
        const host = makeHost({
            chainRegistry: { get: () => descriptor, list: () => [descriptor], supportedChains: () => [descriptor] },
            sdkRegistry: { get: () => sdk, for: () => sdk },
        });
        const request = {
            chainId: CHAIN,
            builder: 'cancelMarketParams',
            from: {
                address: SOURCE,
                publicKey: '02aabbcc',
                derivationPath: "m/84'/1'/0'/0/0",
            },
            params: { feedActionIndex: 42 },
        };

        const accepted = await call(host, 'action.bet.psbt', request);
        expect(accepted.ok, JSON.stringify(accepted.error ?? {})).toBe(true);
        expect(accepted).toMatchObject({
            ok: true,
            result: { psbtHex: '70736274ff00', action: 'BET', version: 1, chainId: CHAIN },
        });
        expect((await call(host, 'action.bet.psbt', {
            ...request, builder: 'arbitrarySdkMethod',
        })).ok).toBe(false);
    });

    it('token.supplyHistory returns a folded series and refuses a missing ticker', async () => {
        const sdk = {
            getIssues: async () => ({ data: [{ block_index: 10, mint_supply: '100' }] }),
            getMints: async () => ({ data: [{ block_index: 12, amount: '25' }] }),
            getDestroys: async () => ({ data: [] }),
            getToken: async () => ({ supply: { current: '125' } }),
        };
        const host = makeHost({ sdkRegistry: { get: () => sdk, for: () => sdk } });

        const accepted = await call(host, 'token.supplyHistory', { chainId: CHAIN, tick: 'TEST' });
        expect(accepted.ok).toBe(true);
        expect(accepted.result.data.map((point) => [point.height, point.supply])).toEqual([
            [10, '100'],
            [12, '125'],
        ]);
        expect((await call(host, 'token.supplyHistory', { chainId: CHAIN })).ok).toBe(false);
    });

    it('utxos.address returns SDK rows and refuses a missing address', async () => {
        const getUTXOs = vi.fn(async () => [{ txid: INPUT_TX, vout: 0, value: 10000 }]);
        const sdk = { getUTXOs };
        const host = makeHost({ sdkRegistry: { get: () => sdk, for: () => sdk } });

        expect(await call(host, 'utxos.address', { chainId: CHAIN, address: SOURCE })).toEqual({
            ok: true,
            result: [{ txid: INPUT_TX, vout: 0, value: 10000 }],
        });
        expect(getUTXOs).toHaveBeenCalledWith(SOURCE);
        expect((await call(host, 'utxos.address', { chainId: CHAIN })).ok).toBe(false);
    });

    it('prices.fiatFetch returns an allowed response and refuses an untrusted URL', async () => {
        const allowed = 'https://explorer.xchain.io/BTC/api/price_snapshots/FINALIZED/status?limit=25';
        const fetchSpy = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ data: [{ price: 1 }] }),
        }));
        vi.stubGlobal('fetch', fetchSpy);
        const host = makeHost();

        expect(await call(host, 'prices.fiatFetch', { url: allowed })).toEqual({
            ok: true,
            result: { ok: true, status: 200, body: { data: [{ price: 1 }] } },
        });
        expect(await call(host, 'prices.fiatFetch', { url: 'https://untrusted.example/rates' })).toEqual({
            ok: true,
            result: { ok: false, status: 0, error: 'not a fiat-rate source' },
        });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
});
