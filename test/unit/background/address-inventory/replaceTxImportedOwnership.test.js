// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { createBackgroundHost } from '../../../../packages/extension/src/background/createBackgroundHost.js';

const CHAIN = 'bitcoin-regtest';
const WALLET = 'wallet-1';
const SOURCE = 'bcrt1qsource';
const DESTINATION = 'bcrt1qdestination';
const TXID = 'aa'.repeat(32);

function replacementHost() {
    const plan = {
        inputs: [{
            prevTxHash: '11'.repeat(32),
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
    const vault = {
        wallets: { get: vi.fn(async () => { throw new Error('wallet inventory unavailable'); }) },
        accounts: { findBy: vi.fn(async () => [{ id: 'account-1', walletId: WALLET }]) },
        addresses: { list: vi.fn(async () => [{
            id: 'address-1',
            accountId: 'account-1',
            address: SOURCE,
            publicKey: '02'.padEnd(66, '1'),
            derivationPath: "m/84'/1'/0'/0/0",
            source: 'hd',
        }]) },
        pendingTxs: { list: vi.fn(async () => [{
            id: 'pending-1',
            chain: 'bitcoin',
            network: 'regtest',
            fromAddress: SOURCE,
            psbtHex: 'original-psbt',
            txHex: '00'.repeat(250),
            txid: TXID,
            status: 'broadcast',
            rbf: true,
        }]) },
        settings: { get: vi.fn(async () => ({ activeNetwork: 'regtest' })) },
    };
    const descriptor = {
        id: CHAIN,
        coin: 'bitcoin',
        networkKind: 'regtest',
        displayName: 'Bitcoin Regtest',
        feeStrategy: { rbfSupported: true },
    };
    return createBackgroundHost({
        vault,
        chainRegistry: {
            get: (id) => (id === CHAIN ? descriptor : null),
            chainIdFor: () => CHAIN,
        },
        sdkRegistry: { get: () => ({
            encoder: { createTx: vi.fn(), broadcastTx: vi.fn() },
            wallet: { decomposePsbt: () => plan },
        }) },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
}

describe('tx.replace imported-address ownership', () => {
    it('refuses a preview when the wallet inventory cannot be read', async () => {
        const response = await replacementHost().handle({
            type: 'tx.replace',
            request: {
                chainId: CHAIN,
                walletId: WALLET,
                originalTxHash: TXID,
                strategy: 'speedup',
                preview: true,
            },
        });

        expect(response.ok).toBe(false);
        expect(response.error.message).toBe('wallet inventory unavailable');
    });
});
