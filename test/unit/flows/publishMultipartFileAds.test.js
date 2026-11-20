// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import { publishMultipartFile } from '../../../packages/core/src/flows/publishMultipartFile.js';

const SOURCE = {
    address: 'bc1qsource',
    publicKey: `02${'ab'.repeat(32)}`,
    derivationPath: "m/84'/0'/0'/0/0",
};
const HASH = 'cd'.repeat(32);
const txid = (number) => number.toString(16).padStart(2, '0').repeat(32);

function plan() {
    return {
        parts: [{ partIndex: 0, rawData: Uint8Array.of(1, 2), digest: '11'.repeat(32) }],
        fileHash: HASH,
        totalParts: 1,
        totalBytes: 2,
        compression: '',
        manifestParams: {
            fileHash: HASH, totalParts: 1, totalBytes: 2,
            name: 'a.bin', type: 'application/octet-stream', title: '', memo: '',
            gateTicker: '', encryptionMethod: '', keyHash: '', gateMinAmount: '', compression: '',
        },
    };
}

function memoryCollection() {
    const rows = new Map();
    return {
        put: vi.fn(async (record) => { rows.set(record.id, structuredClone(record)); }),
        get: vi.fn(async (id) => rows.has(id) ? structuredClone(rows.get(id)) : null),
    };
}

function multipartSdk() {
    let signed = 0;
    let actionIndex = 10;
    const encoder = {
        createTx: vi.fn(async (opts) => {
            if (opts.customOutputs) {
                return {
                    psbt: 'funding',
                    outputs: opts.customOutputs.map((output, vout) => ({
                        vout, ...output, scriptPubKey: `script-${vout}`,
                    })),
                };
            }
            return { psbt: 'commit', revealPsbt: 'reveal', encoding: 'TAPROOT' };
        }),
        broadcastTx: vi.fn(async () => ({})),
        getTxBlock: vi.fn(async () => ({ block_height: 12 })),
        getUTXOs: vi.fn(async () => ({ utxos: [] })),
    };
    return {
        signer: { signPsbt: async () => {
            signed += 1;
            return { txid: txid(signed), txHex: `${signed}00` };
        } },
        sdk: {
            encoder,
            actions: { createAction: ({ params }) => ({ actionString: JSON.stringify(params) }) },
            wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
            waitForAction: vi.fn(async () => ({ actions: [{ action: 'FILE', action_index: actionIndex++ }] })),
            getAction: vi.fn(async () => ({ data: [{ multipart: {
                file_hash: HASH, total_parts: 1, parts_received: 1, total_bytes: 2, status: 'complete',
            } }] })),
        },
    };
}

function harness(networkKind) {
    let settings = {
        activeNetwork: networkKind,
        fiatCurrency: 'USD',
        ads: {
            perTransaction: '0.05', sendAt: '5', recipient: 'protocol', currency: 'USD',
            queued: '0', donated: '0', donationCount: 0,
        },
    };
    const { sdk, signer } = multipartSdk();
    const vault = {
        pendingFileUploads: memoryCollection(),
        settings: {
            get: async () => structuredClone(settings),
            put: async (next) => { settings = structuredClone(next); },
        },
    };
    return {
        ads: () => settings.ads,
        args: {
            vault,
            adsVault: vault,
            walletId: 'wallet-1',
            chainId: `bitcoin-${networkKind}`,
            chainRegistry: { get: () => ({ coin: 'bitcoin', networkKind }) },
            from: SOURCE,
            bytes: Uint8Array.of(7, 8),
            meta: { name: 'a.bin', type: 'application/octet-stream' },
            signer,
            sdkRegistry: { get: () => sdk },
            lane: 'envelope',
            buildMode: 'one_call',
            activationTimes: { mainnet: 0, testnet: 0, regtest: 0 },
            rate: 1,
            outputFloor: 100,
            sizes: { envelopePairVbytes: () => 8, standardPairBytes: () => 8 },
            planMultipartFile: async () => plan(),
            sleep: async () => {},
        },
    };
}

describe('multipart ADS accrual', () => {
    it('books funding, commit, and reveal transactions on mainnet', async () => {
        const h = harness('mainnet');
        await publishMultipartFile(h.args);
        expect(h.ads().queued).toBe('0.25');
        expect(h.ads().bookedKeys).toBeUndefined();
    });

    it('does not book the same upload on a test network', async () => {
        const h = harness('testnet');
        await publishMultipartFile(h.args);
        expect(h.ads().queued).toBe('0');
    });
});
