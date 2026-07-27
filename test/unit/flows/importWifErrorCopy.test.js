// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Wallet E2E session 16 / D-64: the import form rendered whatever the flow
// threw, so a mistyped key came back as
// "importWif: Failed to import WIF: Non-base58 character" - a function name
// the user has never heard of, wrapped around a library internal. 
// fixed exactly this on the recovery-phrase lane and stopped there.
//
// The copy is asserted at the flow layer because that is where it has to
// live: the error crosses the extension messaging boundary as a bare string,
// so the class and the SDK's code are gone by the time a form sees it.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    importWif,
    InvalidWifError,
    WrongPasswordError,
} from '../../../packages/core/src/flows/importWif.js';
import { wifFailureMessage } from '../../../packages/core/src/flows/_wifFailureMessage.js';
import { InvalidWifError as SingleWifError } from '../../../packages/core/src/flows/importSingleWif.js';
import { encrypt, bytesToBase64 } from '../../../packages/core/src/crypto/index.js';

const MASTER_KEY = new Uint8Array(32).fill(7);
const OTHER_KEY = new Uint8Array(32).fill(9);

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => { m.delete(id); },
        findBy: async (field, value) => Array.from(m.values())
            .filter((r) => r[field] === value)
            .map((r) => JSON.parse(JSON.stringify(r))),
    };
}

const DESCRIPTOR = {
    id: 'bitcoin-regtest',
    coin: 'bitcoin',
    networkKind: 'regtest',
    defaultAddressType: 'p2pkh',
    addressTypes: ['p2pkh', 'p2wpkh'],
};
const chainRegistry = { get: (id) => (id === DESCRIPTOR.id ? DESCRIPTOR : null) };

function throwingSdk(err) {
    return { get: () => ({ wallet: { importWIF: () => { throw err; }, deriveAddress: () => 'mADDR' } }) };
}

let vault;
beforeEach(async () => {
    const encryptedSeed = bytesToBase64(await encrypt(MASTER_KEY, new Uint8Array(16).fill(3)));
    vault = {
        wallets: memCollection([
            { id: 'w1', schemaVersion: 1, name: 'Main', encryptedSeed, kdfParams: {}, importedKeys: [] },
        ]),
        accounts: memCollection(),
        addresses: memCollection(),
    };
});

function doImport(sdkRegistry, masterKey = MASTER_KEY) {
    return importWif({
        vault,
        walletId: 'w1',
        masterKey,
        chainRegistry,
        sdkRegistry,
        chainId: 'bitcoin-regtest',
        wif: 'cSV3notparsedbythestub',
    });
}

// Every string this lane can put on screen has to clear the same bar.
function expectUserFacing(message) {
    expect(message).not.toMatch(/importWif|importSingleWif/);
    expect(message).not.toMatch(/non-base58/i);
    expect(message).not.toMatch(/^[a-z][A-Za-z0-9_$]*(\.[A-Za-z0-9_$]+)*:\s/);
    // Copy, not a fragment: a sentence the user can act on.
    expect(message.length).toBeGreaterThan(20);
    expect(message).toMatch(/^[A-Z]/);
    expect(message).toMatch(/\.$/);
}

describe('D-64: wifFailureMessage classifies a rejected key in plain language', () => {
    it('names a network mismatch, the mistake a user is most likely to make', () => {
        const m = wifFailureMessage(
            'WIF key does not match configured network "bitcoin-regtest".',
            'NETWORK_MISMATCH',
        );
        expect(m).toMatch(/different network/i);
        expectUserFacing(m);
    });

    it('classifies on the SDK code alone, without the message', () => {
        // The code is the reliable half; the message is free text the SDK
        // may reword at any time.
        expect(wifFailureMessage('', 'NETWORK_MISMATCH')).toMatch(/different network/i);
    });

    it('turns a base58 failure into something a user can check', () => {
        const m = wifFailureMessage('Failed to import WIF: Non-base58 character', 'INVALID_WIF');
        expect(m).toMatch(/not a valid private key/i);
        expectUserFacing(m);
    });

    it('covers a checksum failure the same way', () => {
        expectUserFacing(wifFailureMessage('Invalid checksum', 'INVALID_WIF'));
    });

    it('asks for the key when there was none', () => {
        expect(wifFailureMessage('WIF string is required.', 'INVALID_WIF')).toMatch(/Paste a WIF/i);
    });

    it('still says something useful for a failure it does not recognize', () => {
        // The fallback is the case that matters most: an unclassified error
        // is exactly the one that used to leak raw.
        expectUserFacing(wifFailureMessage('kaboom', 'SOMETHING_NEW'));
        expectUserFacing(wifFailureMessage(undefined, undefined));
    });
});

describe('D-64: importWif surfaces plain copy, not the SDK internal', () => {
    it('rejects a malformed key without naming the flow or the library', async () => {
        const err = new Error('Failed to import WIF: Non-base58 character');
        err.code = 'INVALID_WIF';
        const caught = await doImport(throwingSdk(err)).catch((e) => e);
        expect(caught).toBeInstanceOf(InvalidWifError);
        expectUserFacing(caught.message);
    });

    it('keeps the library text on .raw so logs and bug reports still have it', async () => {
        const err = new Error('Failed to import WIF: Non-base58 character');
        err.code = 'INVALID_WIF';
        const caught = await doImport(throwingSdk(err)).catch((e) => e);
        // Preserved, not lost - the fix is to stop RENDERING it, not to
        // discard the one string that identifies the cause.
        expect(caught.raw).toContain('Non-base58');
        expect(caught.code).toBe('INVALID_WIF');
    });

    it('tells a mainnet-key-on-regtest user which half is wrong', async () => {
        const err = new Error('WIF key does not match configured network "bitcoin-regtest".');
        err.code = 'NETWORK_MISMATCH';
        const caught = await doImport(throwingSdk(err)).catch((e) => e);
        expect(caught.message).toMatch(/different network/i);
        expectUserFacing(caught.message);
    });

    it('says a wrong password in plain language too', async () => {
        // The one error on this form a user causes by simply mistyping, so
        // the one most likely of all of them to be read.
        const ok = { get: () => ({ wallet: { importWIF: () => ({ publicKeyHex: '02aa' }), deriveAddress: () => 'mADDR' } }) };
        const caught = await doImport(ok, OTHER_KEY).catch((e) => e);
        expect(caught).toBeInstanceOf(WrongPasswordError);
        expectUserFacing(caught.message);
        // Consumers key recovery off the name, so it must not drift.
        expect(caught.name).toBe('WrongPasswordError');
    });
});

describe('D-64: the wif-only onboarding lane says the same thing', () => {
    it('does not greet a new user with "importSingleWif: ..."', () => {
        const e = new SingleWifError('Failed to import WIF: Non-base58 character', 'INVALID_WIF');
        expectUserFacing(e.message);
        expect(e.raw).toContain('Non-base58');
    });

    it('words an identical rejection identically on both lanes', () => {
        const a = new InvalidWifError('Invalid checksum', 'INVALID_WIF');
        const b = new SingleWifError('Invalid checksum', 'INVALID_WIF');
        expect(a.message).toBe(b.message);
    });
});
