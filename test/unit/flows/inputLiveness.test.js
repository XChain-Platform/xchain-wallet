// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// §4.6 input liveness .
//
// The property under test is asymmetric on purpose: proving a coin SPENT takes
// a positive answer from its own address, while every gap - a dead explorer, an
// unresolvable script, an address nobody asked about - has to land in
// `unknown`. A check that guessed "spent" would be a non-overridable block on a
// transaction the network would accept, which is the §4.2 false-block invariant.

import { describe, it, expect } from 'vitest';
import { checkInputLiveness, inputAddresses, livenessMessage } from '../../../packages/core/src/flows/inputLiveness.js';

const input = (txid, vout, address) => ({ prevTxHash: txid, prevTxIndex: vout, address });

describe('checkInputLiveness', () => {

    it('is live when every input is still in its address utxo set', () => {
        const res = checkInputLiveness({
            inputs: [input('aa', 0, 'addr1'), input('bb', 1, 'addr2')],
            utxosByAddress: {
                addr1: [{ txid: 'aa', vout: 0 }, { txid: 'cc', vout: 3 }],
                addr2: [{ txid: 'bb', vout: 1 }],
            },
        });
        expect(res).toEqual({ verdict: 'live', spent: [], unknown: [] });
    });

    it('is spent when the input address answered and does not carry the outpoint', () => {
        const res = checkInputLiveness({
            inputs: [input('aa', 0, 'addr1')],
            utxosByAddress: { addr1: [{ txid: 'zz', vout: 9 }] },
        });
        expect(res.verdict).toBe('spent');
        expect(res.spent).toEqual([{ txid: 'aa', vout: 0 }]);
    });

    it('is spent on an EMPTY answer, which is the legitimate "nothing left" case', () => {
        const res = checkInputLiveness({
            inputs: [input('aa', 0, 'addr1')],
            utxosByAddress: { addr1: [] },
        });
        expect(res.verdict).toBe('spent');
    });

    // The distinction the whole module turns on: an address that did NOT answer
    // is absent from the map, and absent must never read as empty.
    it('is unknown when the input address never answered', () => {
        const res = checkInputLiveness({
            inputs: [input('aa', 0, 'addr1')],
            utxosByAddress: {},
        });
        expect(res.verdict).toBe('unknown');
        expect(res.spent).toEqual([]);
        expect(res.unknown).toEqual([{ txid: 'aa', vout: 0 }]);
    });

    it('is unknown for an input whose script did not decode to an address', () => {
        const res = checkInputLiveness({
            inputs: [input('aa', 0, null)],
            utxosByAddress: { addr1: [{ txid: 'aa', vout: 0 }] },
        });
        expect(res.verdict).toBe('unknown');
    });

    it('a single proven-spent input outranks any number of unknown ones', () => {
        const res = checkInputLiveness({
            inputs: [input('aa', 0, 'addr1'), input('bb', 0, null), input('cc', 0, 'nobody')],
            utxosByAddress: { addr1: [] },
        });
        expect(res.verdict).toBe('spent');
        expect(res.spent).toHaveLength(1);
        expect(res.unknown).toHaveLength(2);
    });

    it('matches outpoints case-insensitively on txid', () => {
        const res = checkInputLiveness({
            inputs: [input('AABB', 2, 'addr1')],
            utxosByAddress: { addr1: [{ txid: 'aabb', vout: 2 }] },
        });
        expect(res.verdict).toBe('live');
    });

    it('does not confuse two vouts of the same txid', () => {
        const res = checkInputLiveness({
            inputs: [input('aa', 1, 'addr1')],
            utxosByAddress: { addr1: [{ txid: 'aa', vout: 0 }] },
        });
        expect(res.verdict).toBe('spent');
    });

    it('treats a malformed or empty input list as nothing to prove', () => {
        expect(checkInputLiveness({ inputs: [], utxosByAddress: {} }).verdict).toBe('live');
        expect(checkInputLiveness({}).verdict).toBe('live');
    });
});

describe('inputAddresses', () => {
    it('returns the distinct resolvable addresses only', () => {
        expect(inputAddresses([
            input('a', 0, 'x'), input('b', 1, 'x'), input('c', 2, null), input('d', 3, 'y'),
        ])).toEqual(['x', 'y']);
    });
});

describe('livenessMessage', () => {
    it('names the re-compose, because §5.3.4 forbids re-signing this PSBT', () => {
        const one = livenessMessage({ spent: [{ txid: 'a', vout: 0 }] });
        expect(one).toMatch(/already been used/);
        expect(one).toMatch(/Start over/);
        expect(livenessMessage({ spent: [{}, {}] })).toMatch(/^2 of the coins/);
        expect(livenessMessage({ spent: [] })).toBe('');
    });
});
