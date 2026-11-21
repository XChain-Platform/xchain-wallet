// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// An account's custody is read from its own HD-derived address records, and
// a signer that does not hold those keys must not derive into the account.

import { describe, expect, it } from 'vitest';

import {
    accountCustody,
    accountDeviceSignerId,
    signerOwnsCustody,
} from '../../../../packages/core/src/flows/addressCustody/accountCustody.js';

const rec = (accountId, source, signerId = null, derivationPath = "m/84'/0'/0'/0/0") => ({
    accountId, source, signerId, derivationPath,
});

describe('accountCustody', () => {
    it('reads a seed account as hd and a linked device account as that device', () => {
        const rows = [rec('a', 'hd'), rec('b', 'trezor', 'sig-1')];
        expect(accountCustody('a', rows)).toEqual({ source: 'hd', signerId: null });
        expect(accountCustody('b', rows)).toEqual({ source: 'trezor', signerId: 'sig-1' });
    });

    it('reports hd and device records in one account as a conflict', () => {
        expect(accountCustody('b', [rec('b', 'hd'), rec('b', 'ledger', 'sig-2')])).toEqual({ conflict: true });
        expect(accountCustody('a', [rec('a', 'hd'), rec('a', 'hd'), rec('a', 'trezor')])).toEqual({ conflict: true });
    });

    it('reports two devices, or two device kinds, as a conflict', () => {
        expect(accountCustody('b', [rec('b', 'trezor', 'sig-1'), rec('b', 'trezor', 'sig-3')])).toEqual({ conflict: true });
        expect(accountCustody('b', [rec('b', 'trezor'), rec('b', 'ledger')])).toEqual({ conflict: true });
    });

    it('ignores records without a derivation path and other accounts, and is null with no evidence', () => {
        const rows = [rec('a', 'imported-wif', null, null), rec('a', 'watch-only', null, null), rec('z', 'trezor', 'x')];
        expect(accountCustody('a', rows)).toBeNull();
    });
});

describe('signerOwnsCustody', () => {
    const seed = { id: 'w1', kind: 'software' };
    const trezor = { id: 'sig-1', kind: 'trezor' };

    it('accepts only the signer that holds the account', () => {
        expect(signerOwnsCustody(seed, { source: 'hd', signerId: null })).toBe(true);
        expect(signerOwnsCustody(trezor, { source: 'trezor', signerId: 'sig-1' })).toBe(true);
        expect(signerOwnsCustody(seed, { source: 'trezor', signerId: 'sig-1' })).toBe(false);
        expect(signerOwnsCustody(trezor, { source: 'hd', signerId: null })).toBe(false);
        expect(signerOwnsCustody({ id: 'sig-9', kind: 'trezor' }, { source: 'trezor', signerId: 'sig-1' })).toBe(false);
    });

    it('accepts any device of the kind for an unlinked device account, and nothing for a conflict', () => {
        expect(signerOwnsCustody({ id: 'sig-9', kind: 'trezor' }, { source: 'trezor', signerId: null })).toBe(true);
        expect(signerOwnsCustody({ id: 'sig-9', kind: 'ledger' }, { source: 'trezor', signerId: null })).toBe(false);
        expect(signerOwnsCustody(trezor, { conflict: true })).toBe(false);
    });

    it('accepts any signer when the account has no evidence, and refuses an unknown kind', () => {
        expect(signerOwnsCustody(seed, null)).toBe(true);
        expect(signerOwnsCustody({ id: 'x', kind: 'mystery' }, { source: 'hd', signerId: null })).toBe(false);
    });
});

describe('accountDeviceSignerId', () => {
    const vault = (rows) => ({
        accounts: { findBy: async () => [{ id: 'a', index: 0 }, { id: 'b', index: 1 }] },
        addresses: { list: async () => rows },
    });

    it('names the linked device of the target account, by id or by index', async () => {
        const v = vault([rec('b', 'trezor', 'sig-1')]);
        await expect(accountDeviceSignerId(v, { walletId: 'w1', accountId: 'b' }, 'r')).resolves.toBe('sig-1');
        await expect(accountDeviceSignerId(v, { walletId: 'w1', accountIndex: 1 }, 'r')).resolves.toBe('sig-1');
        await expect(accountDeviceSignerId(v, { walletId: 'w1', accountId: 'b', signerId: 'sig-1' }, 'r'))
            .resolves.toBe('sig-1');
    });

    it('refuses a request naming another device', async () => {
        const v = vault([rec('b', 'trezor', 'sig-1')]);
        await expect(accountDeviceSignerId(v, { walletId: 'w1', accountId: 'b', signerId: 'sig-2' }, 'route.x'))
            .rejects.toThrow(/route\.x: the request names a different device/);
    });

    it('refuses rather than fall back to the seed for an account the seed does not hold', async () => {
        const v = vault([rec('a', 'hd'), rec('b', 'trezor')]);
        await expect(accountDeviceSignerId(v, { walletId: 'w1', accountId: 'b' }, 'r'))
            .rejects.toThrow(/r: this account is held on a trezor device that none of its addresses names/);
        await expect(accountDeviceSignerId(v, { walletId: 'w1', accountId: 'a', signerId: 'sig-1' }, 'r'))
            .rejects.toThrow(/held by the wallet seed, not a device/);
        const mixed = vault([rec('a', 'hd'), rec('a', 'trezor', 'sig-1')]);
        await expect(accountDeviceSignerId(mixed, { walletId: 'w1', accountId: 'a' }, 'r'))
            .rejects.toThrow(/more than one signer/);
    });

    it('refuses a requested device of another kind for an unlinked device account', async () => {
        const v = {
            ...vault([rec('b', 'trezor')]),
            signers: { get: async (id) => ({ id, kind: id === 'led' ? 'ledger' : 'trezor' }) },
        };
        await expect(accountDeviceSignerId(v, { walletId: 'w1', accountId: 'b', signerId: 'led' }, 'r'))
            .rejects.toThrow(/different kind of device/);
        await expect(accountDeviceSignerId(v, { walletId: 'w1', accountId: 'b', signerId: 'tz' }, 'r'))
            .resolves.toBe('tz');
    });

    it('keeps the request choice for a seed, unlinked or unknown account', async () => {
        const v = vault([rec('a', 'hd'), rec('b', 'trezor')]);
        await expect(accountDeviceSignerId(v, { walletId: 'w1', accountId: 'a' }, 'r')).resolves.toBeNull();
        await expect(accountDeviceSignerId(v, { walletId: 'w1', accountId: 'b', signerId: 's' }, 'r')).resolves.toBe('s');
        await expect(accountDeviceSignerId(v, { walletId: 'w1', accountId: 'missing' }, 'r')).resolves.toBeNull();
    });
});
