// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for RemoteSigner: the Signer shim that forwards every
// interface call over an injected transport function.

import { describe, it, expect } from 'vitest';
import { RemoteSigner } from '../../../packages/core/src/signers/RemoteSigner.js';
import { SignerStatusError } from '../../../packages/core/src/signers/Signer.js';

function makeSigner(transport, overrides = {}) {
    return new RemoteSigner({
        id: 'sig-1',
        displayName: 'My Ledger',
        kind: 'ledger',
        transport,
        ...overrides,
    });
}

describe('signers/RemoteSigner', () => {
    describe('constructor validation', () => {
        const base = { id: 'a', displayName: 'b', kind: 'ledger', transport: () => {} };

        it('builds with valid options and exposes its identity getters', () => {
            const s = makeSigner(async () => {});
            expect(s.id).toBe('sig-1');
            expect(s.displayName).toBe('My Ledger');
            expect(s.kind).toBe('ledger');
            expect(s.requiresPhysicalConfirmation).toBe(true);
        });

        it('throws when id is missing', () => {
            expect(() => new RemoteSigner({ ...base, id: '' })).toThrow(/id is required/);
        });

        it('throws when displayName is missing', () => {
            expect(() => new RemoteSigner({ ...base, displayName: '' })).toThrow(/displayName is required/);
        });

        it('throws when kind is not trezor or ledger', () => {
            expect(() => new RemoteSigner({ ...base, kind: 'keystone' })).toThrow(/kind must be/);
        });

        it('accepts kind "trezor"', () => {
            expect(new RemoteSigner({ ...base, kind: 'trezor' }).kind).toBe('trezor');
        });

        it('throws when transport is not a function', () => {
            expect(() => new RemoteSigner({ ...base, transport: null })).toThrow(/transport must be a function/);
        });
    });

    describe('getStatus', () => {
        it('returns a bare string status', async () => {
            const s = makeSigner(async () => 'connected');
            expect(await s.getStatus()).toBe('connected');
        });

        it('unwraps a { status } object', async () => {
            const s = makeSigner(async () => ({ status: 'locked', detail: 'x' }));
            expect(await s.getStatus()).toBe('locked');
        });

        it('returns "error" for an unrecognised shape', async () => {
            const s = makeSigner(async () => ({ nope: true }));
            expect(await s.getStatus()).toBe('error');
        });

        it('returns "disconnected" when the transport throws', async () => {
            const s = makeSigner(async () => { throw new Error('boom'); });
            expect(await s.getStatus()).toBe('disconnected');
        });

        it('passes op:status and the signer id to the transport', async () => {
            let seen = null;
            const s = makeSigner(async (req) => { seen = req; return 'connected'; });
            await s.getStatus();
            expect(seen).toEqual({ op: 'status', payload: { signerId: 'sig-1' } });
        });
    });

    describe('getAddresses', () => {
        it('returns the remote array', async () => {
            const addrs = [{ address: 'bc1q...' }];
            const s = makeSigner(async () => addrs);
            expect(await s.getAddresses({ chain: 'BTC' })).toBe(addrs);
        });

        it('threads signerId + params into the transport payload', async () => {
            let seen = null;
            const s = makeSigner(async (req) => { seen = req; return []; });
            await s.getAddresses({ chain: 'BTC', count: 5 });
            expect(seen).toEqual({ op: 'getAddresses', payload: { chain: 'BTC', count: 5, signerId: 'sig-1' } });
        });

        it('throws SignerStatusError when the remote returns a non-array', async () => {
            const s = makeSigner(async () => ({ not: 'array' }));
            await expect(s.getAddresses({})).rejects.toBeInstanceOf(SignerStatusError);
        });

        it('wraps a transport rejection in a SignerStatusError', async () => {
            const s = makeSigner(async () => { throw new Error('device gone'); });
            await expect(s.getAddresses({})).rejects.toThrow(/getAddresses failed: device gone/);
        });
    });

    describe('getPublicKey', () => {
        it('forwards the result unchanged', async () => {
            const pk = { publicKey: '02ab', path: "m/44'/0'/0'" };
            const s = makeSigner(async () => pk);
            expect(await s.getPublicKey({})).toBe(pk);
        });
    });

    describe('signPsbt', () => {
        it('returns a normalised result with a defaulted signedPsbtHex', async () => {
            const s = makeSigner(async () => ({ txHex: 'aa', txid: 'bb' }));
            expect(await s.signPsbt({})).toEqual({ signedPsbtHex: '', txHex: 'aa', txid: 'bb' });
        });

        it('preserves a provided signedPsbtHex', async () => {
            const s = makeSigner(async () => ({ signedPsbtHex: 'cc', txHex: 'aa', txid: 'bb' }));
            expect((await s.signPsbt({})).signedPsbtHex).toBe('cc');
        });

        it('throws on a malformed (missing txid) result', async () => {
            const s = makeSigner(async () => ({ txHex: 'aa' }));
            await expect(s.signPsbt({})).rejects.toThrow(/malformed result/);
        });

        it('throws on a null result', async () => {
            const s = makeSigner(async () => null);
            await expect(s.signPsbt({})).rejects.toBeInstanceOf(SignerStatusError);
        });

        it('wraps a transport rejection (user cancelled)', async () => {
            const s = makeSigner(async () => { throw new Error('cancelled'); });
            await expect(s.signPsbt({})).rejects.toThrow(/signPsbt failed: cancelled/);
        });
    });

    describe('signMessage', () => {
        it('returns the signature', async () => {
            const s = makeSigner(async () => ({ signature: 'deadbeef' }));
            expect(await s.signMessage({})).toEqual({ signature: 'deadbeef' });
        });

        it('throws when no signature is returned', async () => {
            const s = makeSigner(async () => ({}));
            await expect(s.signMessage({})).rejects.toThrow(/no signature/);
        });
    });

    describe('_callOrThrow error stringification', () => {
        it('stringifies a non-Error rejection value', async () => {
            const s = makeSigner(async () => { throw 'plain-string-failure'; });
            await expect(s.getPublicKey({})).rejects.toThrow(/getPublicKey failed: plain-string-failure/);
        });
    });
});
