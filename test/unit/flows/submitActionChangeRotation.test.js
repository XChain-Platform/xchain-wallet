// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

//  at the seam that decides what actually goes on chain.
//
// `submitAction` is the one flow every atomic (non-prebuilt) submission
// funnels through, and the encoderOpts it hands submitWithSigner are what
// the encoder builds the change output from. Testing the rotation only at
// flows/changeAddress.js would prove a fresh address can be derived, not
// that the transaction pays it - which was exactly the shape of the
// original defect: the setting persisted, and nothing read it.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const submitWithSignerMock = vi.fn();
vi.mock('../../../packages/core/src/sdk/submitWithSigner.js', () => ({
    submitWithSigner: (...args) => submitWithSignerMock(...args),
    BroadcastFailedError: class BroadcastFailedError extends Error {},
}));

const { submitAction } = await import('../../../packages/core/src/flows/submitAction.js');
const { createAddress } = await import('../../../packages/core/src/schemas/address.js');

const CHAIN = 'bitcoin-regtest';
const SOURCE = 'addr_0_0_0';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => { m.delete(id); },
        findBy: async (field, value) =>
            Array.from(m.values()).filter((r) => r[field] === value)
                .map((r) => JSON.parse(JSON.stringify(r))),
    };
}

const ACCOUNT = {
    schemaVersion: 2, id: 'acct-a', walletId: 'w1', name: 'A', index: 0,
    activeAddressByChainId: {}, createdAt: '2026-01-01T00:00:00.000Z',
};

function sourceRow() {
    return createAddress({
        accountId: 'acct-a',
        chain: 'bitcoin',
        network: 'regtest',
        source: 'hd',
        addressType: 'p2wpkh',
        derivationPath: "m/84'/1'/0'/0/0",
        address: SOURCE,
        publicKey: 'pub_0_0_0',
        label: 'BTC Address #1',
    });
}

function harness(settings) {
    return {
        vault: {
            accounts: memCollection([ACCOUNT]),
            addresses: memCollection([sourceRow()]),
            wallets: memCollection([{ id: 'w1', format: 'bip39' }]),
            settings: { get: async () => settings, put: async () => {} },
        },
        chainRegistry: {
            get: () => ({
                coin: 'bitcoin',
                networkKind: 'regtest',
                defaultAddressType: 'p2wpkh',
                addressTypes: ['p2wpkh'],
            }),
        },
        sdkRegistry: {},
        signer: {
            id: 'signer-1',
            kind: 'software',
            async getAddresses({ accountIndex, change, startIndex }) {
                return [{
                    index: startIndex,
                    address: `addr_${accountIndex}_${change}_${startIndex}`,
                    publicKey: `pub_${accountIndex}_${change}_${startIndex}`,
                    path: `m/84'/1'/${accountIndex}'/${change}/${startIndex}`,
                }];
            },
        },
    };
}

function call(h, extra = {}) {
    return submitAction({
        vault: h.vault,
        walletId: 'w1',
        chainRegistry: h.chainRegistry,
        sdkRegistry: h.sdkRegistry,
        chainId: CHAIN,
        actionData: { action: 'SEND', params: { DESTINATION: 'bcrt1qdest', TICK: 'XCP', AMOUNT: '1' } },
        encoderOpts: { pubkey: 'ab', change: SOURCE, sourceAddress: SOURCE },
        signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }],
        signer: h.signer,
        ...extra,
    });
}

function encoderOptsSeen() {
    return submitWithSignerMock.mock.calls[0][0].encoderOpts;
}

beforeEach(() => {
    submitWithSignerMock.mockReset();
    submitWithSignerMock.mockResolvedValue({
        txid: 'aa'.repeat(32),
        actionString: 'SEND|...',
        action: 'SEND',
        encoding: 'OP_RETURN',
        signed: { txHex: '00', txid: 'aa', signedPsbtHex: '00' },
        indexed: null,
    });
});

describe('submitAction honours Settings > Privacy change-address rotation', () => {
    it('[REGRESSION] change returns to the SOURCE address when rotation is off', async () => {
        const h = harness({ privacy: { changeAddressRotation: false } });
        const result = await call(h);
        expect(encoderOptsSeen().change).toBe(SOURCE);
        expect(result.changeRotated).toBe(false);
        expect(result.changeAddress).toBe(SOURCE);
    });

    it('pays change to a fresh internal address when rotation is on', async () => {
        const h = harness({ privacy: { changeAddressRotation: true } });
        const result = await call(h);
        const seen = encoderOptsSeen();
        expect(seen.change).toBe('addr_0_1_0');
        expect(seen.change).not.toBe(SOURCE);
        // Funding still comes from the spender: `change` is deliberately NOT a
        // fallback for `sourceAddress` in the SDK encoder.
        expect(seen.sourceAddress).toBe(SOURCE);
        expect(result.changeRotated).toBe(true);
    });

    it('advances the index on the next send instead of reusing one address', async () => {
        const h = harness({ privacy: { changeAddressRotation: true } });
        await call(h);
        submitWithSignerMock.mockClear();
        await call(h);
        expect(encoderOptsSeen().change).toBe('addr_0_1_1');
    });

    it('leaves a caller-chosen change destination alone', async () => {
        // createList and friends deliberately point change somewhere that is
        // not the spender. A privacy preference does not get to move funds the
        // caller placed on purpose.
        const h = harness({ privacy: { changeAddressRotation: true } });
        await call(h, { encoderOpts: { pubkey: 'ab', change: 'bcrt1qelsewhere', sourceAddress: SOURCE } });
        expect(encoderOptsSeen().change).toBe('bcrt1qelsewhere');
    });

    it('does not rotate on the prebuilt-PSBT path, whose bytes are already fixed', async () => {
        const h = harness({ privacy: { changeAddressRotation: true } });
        await call(h, { prebuiltPsbt: { psbt: '70736274ff', encoding: 'OP_RETURN', actionString: 'SEND|...' } });
        expect(encoderOptsSeen().change).toBe(SOURCE);
        // And no index was burned for a rotation that could not reach the wire.
        const rows = await h.vault.addresses.list();
        expect(rows.length).toBe(1);
    });
});
