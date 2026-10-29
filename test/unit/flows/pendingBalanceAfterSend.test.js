// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    applyPendingBalanceDeltas,
    walletBalances,
} from '../../../packages/core/src/flows/balances.js';
import {
    nativeDebitSatsFromPsbt,
} from '../../../packages/core/src/flows/submitAction.js';
import { sendToken } from '../../../packages/core/src/flows/sendToken.js';

const CHAIN_ID = 'bitcoin-regtest';
const SOURCE = 'bcrt1qsource';
const CHANGE = 'bcrt1qchange';

const chainRegistry = {
    chainIdFor: (coin, network) => (
        coin === 'bitcoin' && network === 'regtest' ? CHAIN_ID : null
    ),
    descriptorFor: (chainId) => (
        chainId === CHAIN_ID
            ? { id: CHAIN_ID, coin: 'bitcoin', networkKind: 'regtest' }
            : null
    ),
    get(chainId) {
        return this.descriptorFor(chainId);
    },
};

function pending(over = {}) {
    return {
        chain: 'bitcoin',
        network: 'regtest',
        fromAddress: SOURCE,
        status: 'broadcast',
        nativeDebitSats: '21000',
        balanceDebits: [
            { tick: 'BTC', amount: '0.0002' },
            { tick: 'PEPE', amount: '1.25' },
        ],
        ...over,
    };
}

function balances() {
    return {
        [CHAIN_ID]: [{
            address: SOURCE,
            balances: {
                native: { tick: 'BTC', quantity: '100000', divisibility: 8 },
                tokens: [
                    { tick: 'PEPE', quantity: '500', divisibility: 2 },
                    { tick: 'DOG', quantity: '900', divisibility: 0 },
                ],
            },
        }],
    };
}

describe('pending send balance projection', () => {
    it('counts payments and fees while excluding owned change', () => {
        expect(nativeDebitSatsFromPsbt({
            inputs: [{ value: '100000' }],
            outputs: [
                { address: 'bcrt1qrecipient', value: '20000' },
                { address: CHANGE, value: '79000' },
            ],
        }, [SOURCE, CHANGE])).toBe('21000');
    });

    it('persists the exact debit from signed bytes before broadcast', async () => {
        const rows = new Map();
        const vault = {
            settings: { get: async () => ({}), put: async () => {} },
            pendingTxs: {
                put: async (row) => { rows.set(row.id, structuredClone(row)); },
            },
            accounts: { findBy: async () => [{ id: 'a1' }] },
            addresses: {
                list: async () => [
                    { id: 'source', accountId: 'a1', address: SOURCE, chain: 'bitcoin', network: 'regtest' },
                    { id: 'change', accountId: 'a1', address: CHANGE, chain: 'bitcoin', network: 'regtest' },
                ],
            },
            wallets: { get: async () => ({ importedKeys: [] }) },
        };
        const decomposed = {
            inputs: [{ value: '100000' }],
            outputs: [
                { address: 'bcrt1qrecipient', value: '20000' },
                { address: CHANGE, value: '79000' },
            ],
        };
        const sdk = {
            actions: {
                createAction: () => ({ actionString: 'SEND|0|PEPE|1|dest', action: 'SEND', version: 0 }),
            },
            encoder: {
                createTx: async () => ({ psbt: 'PSBT', encoding: 'OP_RETURN' }),
                broadcastTx: async () => ({}),
            },
            wallet: { decomposePsbt: () => decomposed },
        };
        const signer = {
            kind: 'software',
            signPsbt: async () => ({ signedPsbtHex: 'SIGNED', txHex: 'TX', txid: 'txid-1' }),
        };

        await sendToken({
            vault,
            walletId: 'w1',
            chainRegistry,
            sdkRegistry: { get: () => sdk },
            chainId: CHAIN_ID,
            from: { address: SOURCE, publicKey: 'pub', derivationPath: 'm/0' },
            to: 'bcrt1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5phstwt',
            tick: 'PEPE',
            amount: '1',
            change: CHANGE,
            signer,
        });

        const [stored] = Array.from(rows.values());
        expect(stored).toMatchObject({
            status: 'broadcast',
            nativeDebitSats: '21000',
            balanceDebits: [{ tick: 'PEPE', amount: '1' }],
        });
    });

    it('subtracts live native and token debits without subtracting the native amount twice', () => {
        const projected = applyPendingBalanceDeltas(balances(), [pending()], chainRegistry);
        const shape = projected[CHAIN_ID][0].balances;

        expect(shape.native.quantity).toBe('79000');
        expect(shape.tokens).toEqual([
            { tick: 'PEPE', quantity: '375', divisibility: 2 },
            { tick: 'DOG', quantity: '900', divisibility: 0 },
        ]);
    });

    it.each(['failed', 'rbf-replaced', 'indexed'])(
        'restores fetched balances for terminal status %s',
        (status) => {
            const projected = applyPendingBalanceDeltas(balances(), [pending({ status })], chainRegistry);
            const shape = projected[CHAIN_ID][0].balances;
            expect(shape.native.quantity).toBe('100000');
            expect(shape.tokens[0].quantity).toBe('500');
        },
    );

    it('restores fetched balances when a dropped record is removed', () => {
        const projected = applyPendingBalanceDeltas(balances(), [], chainRegistry);
        const shape = projected[CHAIN_ID][0].balances;
        expect(shape.native.quantity).toBe('100000');
        expect(shape.tokens[0].quantity).toBe('500');
    });

    it('applies every token leg from a multi-send', () => {
        const projected = applyPendingBalanceDeltas(balances(), [pending({
            nativeDebitSats: '1000',
            balanceDebits: [
                { tick: 'PEPE', amount: '2' },
                { tick: 'DOG', amount: '300' },
            ],
        })], chainRegistry);
        const shape = projected[CHAIN_ID][0].balances;
        expect(shape.native.quantity).toBe('99000');
        expect(shape.tokens.map((token) => token.quantity)).toEqual(['300', '600']);
    });

    it('projects persisted pending records in the wallet balance read', async () => {
        const vault = {
            accounts: { findBy: async () => [{ id: 'a1', walletId: 'w1' }] },
            wallets: { get: async () => ({ id: 'w1', importedKeys: [] }) },
            addresses: {
                list: async () => [{
                    id: 'addr-1', accountId: 'a1', address: SOURCE,
                    addressType: 'p2wpkh', derivationPath: 'm/0', label: 'Source',
                    chain: 'bitcoin', network: 'regtest',
                }],
            },
            pendingTxs: { list: async () => [pending()] },
        };
        const sdkRegistry = {
            get: () => ({
                getBalances: async () => ({
                    data: [{ tick: 'PEPE', amount: '5', decimals: 2 }],
                }),
                getAddress: async () => ({ balances: { confirmed: '0.001', pending: '0' } }),
            }),
        };

        const result = await walletBalances({
            vault, walletId: 'w1', chainRegistry, sdkRegistry,
        });
        const shape = result[CHAIN_ID][0].balances;
        expect(shape.native.quantity).toBe('79000');
        expect(shape.tokens[0].quantity).toBe('375');
    });

    it.each([
        ['indexed after reload', { block_height: 101 }, '10', 'indexed'],
        ['still unconfirmed after reload', null, '6', 'broadcast'],
    ])('%s reconciles before netting the fetched token balance', async (
        _label, inclusion, expectedQuantity, expectedStatus,
    ) => {
        const txid = 'ab'.repeat(32);
        const rows = [pending({
            id: 'send-1',
            txid,
            nativeDebitSats: null,
            balanceDebits: [{ tick: 'CBH', amount: '4' }],
            createdAt: '2026-10-29T12:00:00.000Z',
            broadcastAt: '2026-10-29T12:00:01.000Z',
        })];
        const vault = {
            accounts: { findBy: async () => [{ id: 'a1', walletId: 'w1' }] },
            wallets: { get: async () => ({ id: 'w1', importedKeys: [] }) },
            addresses: {
                list: async () => [{
                    id: 'addr-1', accountId: 'a1', address: SOURCE,
                    addressType: 'p2wpkh', derivationPath: 'm/0', label: 'Source',
                    chain: 'bitcoin', network: 'regtest',
                }],
            },
            pendingTxs: {
                list: async () => rows.map((row) => structuredClone(row)),
                findBy: async (field, value) => rows
                    .filter((row) => row[field] === value)
                    .map((row) => structuredClone(row)),
                put: async (record) => {
                    const index = rows.findIndex((row) => row.id === record.id);
                    rows[index] = structuredClone(record);
                },
            },
        };
        const getTxBlock = vi.fn(async () => inclusion);
        const getBalancesBatch = vi.fn(async () => ({
            [SOURCE]: {
                balances: { data: [{ tick: 'CBH', amount: '10', decimals: 0 }] },
                address: { balances: { confirmed: '1', pending: '0' } },
                error: null,
            },
        }));
        const sdk = {
            getBalancesBatch,
            getTransaction: vi.fn(async () => null),
            encoder: { getTxBlock },
        };

        const result = await walletBalances({
            vault,
            walletId: 'w1',
            chainRegistry,
            sdkRegistry: { get: () => sdk },
        });

        expect(result[CHAIN_ID][0].balances.tokens[0].quantity).toBe(expectedQuantity);
        expect(rows[0].status).toBe(expectedStatus);
        expect(getTxBlock).toHaveBeenCalledWith(txid);
        expect(getBalancesBatch).toHaveBeenCalledWith(
            [SOURCE], inclusion ? { fresh: true } : undefined,
        );
        expect(getTxBlock.mock.invocationCallOrder[0])
            .toBeLessThan(getBalancesBatch.mock.invocationCallOrder[0]);
    });

    it('asks about a still-unconfirmed send at most once a minute across Home polls', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(new Date('2026-10-29T12:05:00.000Z'));
            const txid = 'cd'.repeat(32);
            const rows = [pending({
                id: 'send-2',
                txid,
                nativeDebitSats: null,
                balanceDebits: [{ tick: 'CBH', amount: '4' }],
                createdAt: '2026-10-29T12:00:00.000Z',
                broadcastAt: '2026-10-29T12:00:01.000Z',
            })];
            const vault = {
                accounts: { findBy: async () => [{ id: 'a1', walletId: 'w1' }] },
                wallets: { get: async () => ({ id: 'w1', importedKeys: [] }) },
                addresses: {
                    list: async () => [{
                        id: 'addr-1', accountId: 'a1', address: SOURCE,
                        addressType: 'p2wpkh', derivationPath: 'm/0', label: 'Source',
                        chain: 'bitcoin', network: 'regtest',
                    }],
                },
                pendingTxs: {
                    list: async () => rows.map((row) => structuredClone(row)),
                    findBy: async () => [],
                    put: async () => {},
                },
            };
            const getTxBlock = vi.fn(async () => null);
            const getTransaction = vi.fn(async () => null);
            const sdk = {
                getBalancesBatch: vi.fn(async () => ({
                    [SOURCE]: {
                        balances: { data: [{ tick: 'CBH', amount: '10', decimals: 0 }] },
                        address: { balances: { confirmed: '1', pending: '0' } },
                        error: null,
                    },
                })),
                getTransaction,
                encoder: { getTxBlock },
            };
            const poll = () => walletBalances({
                vault, walletId: 'w1', chainRegistry, sdkRegistry: { get: () => sdk },
            });

            const first = await poll();
            vi.setSystemTime(new Date('2026-10-29T12:05:20.000Z'));
            const second = await poll();
            expect(getTxBlock).toHaveBeenCalledTimes(1);
            expect(getTransaction).toHaveBeenCalledTimes(1);
            expect(first[CHAIN_ID][0].balances.tokens[0].quantity).toBe('6');
            expect(second[CHAIN_ID][0].balances.tokens[0].quantity).toBe('6');

            vi.setSystemTime(new Date('2026-10-29T12:06:01.000Z'));
            await poll();
            expect(getTxBlock).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });
});
