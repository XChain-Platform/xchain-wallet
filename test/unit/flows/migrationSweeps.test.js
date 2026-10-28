// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Migrate-to-BIP39 sweep list outlives the wizard screen: it is kept per
// legacy wallet, holds only addresses, ids and flags, marks rows as their
// sweeps broadcast, and goes when either wallet of the pair is removed.

import { afterEach, describe, expect, it } from 'vitest';
import {
    MIGRATION_SWEEPS_STORAGE_KEY,
    clearMigrationSweeps,
    dismissMigrationSweeps,
    markMigrationSwept,
    pendingMigrationSweeps,
    readMigrationSweeps,
    recordMigration,
    setMigrationRows,
    subscribeMigrationSweeps,
} from '../../../packages/core/src/flows/migrationSweeps.js';
import {
    clearRemovedWalletStorage,
    wipeWalletStorage,
} from '../../../packages/core/src/shared/utils/wipeWalletStorage.js';

const ROWS = [
    { chainId: 'bitcoin', fromAddress: 'legacy-0', toAddress: 'new-btc' },
    { chainId: 'bitcoin', fromAddress: 'legacy-1', toAddress: 'new-btc' },
    { chainId: 'litecoin', fromAddress: 'legacy-ltc', toAddress: 'new-ltc' },
];

afterEach(() => {
    clearMigrationSweeps();
    localStorage.clear();
});

describe('migration sweep list store', () => {
    it('keeps the pair and the address list across reads', () => {
        recordMigration('old', 'new');
        expect(pendingMigrationSweeps('old')).toEqual({ newWalletId: 'new', listed: false, rows: [] });
        setMigrationRows('old', 'new', ROWS);
        expect(readMigrationSweeps('old')).toEqual({
            newWalletId: 'new',
            listed: true,
            rows: ROWS.map((row) => ({ ...row, swept: false })),
        });
    });

    it('stores only addresses, ids, txids and flags', () => {
        recordMigration('old', 'new');
        setMigrationRows('old', 'new', ROWS.map((row) => ({ ...row, privateKey: 'k', mnemonic: 'm', password: 'p' })));
        markMigrationSwept('old', { newWalletId: 'new', chainId: 'bitcoin', fromAddress: 'legacy-0', txid: 'tx-1', wif: 'k' });
        const stored = JSON.parse(localStorage.getItem(MIGRATION_SWEEPS_STORAGE_KEY));
        expect(Object.keys(stored)).toEqual(['old']);
        expect(Object.keys(stored.old).sort()).toEqual(['listed', 'newWalletId', 'rows']);
        for (const row of stored.old.rows) {
            for (const key of Object.keys(row)) {
                expect(['chainId', 'fromAddress', 'toAddress', 'swept', 'txid']).toContain(key);
            }
        }
    });

    it('marks a broadcast sweep and keeps the mark when the list is rewritten', () => {
        recordMigration('old', 'new');
        setMigrationRows('old', 'new', ROWS);
        expect(markMigrationSwept('old', { newWalletId: 'new', chainId: 'bitcoin', fromAddress: 'legacy-0', txid: 'tx-1' })).toBe(true);
        setMigrationRows('old', 'new', ROWS);
        const rows = readMigrationSweeps('old').rows;
        expect(rows[0]).toEqual({ chainId: 'bitcoin', fromAddress: 'legacy-0', toAddress: 'new-btc', swept: true, txid: 'tx-1' });
        expect(rows.slice(1).every((row) => row.swept === false)).toBe(true);
    });

    it('ignores a sweep into a wallet other than the recorded destination', () => {
        recordMigration('old', 'new');
        setMigrationRows('old', 'new', ROWS);
        expect(markMigrationSwept('old', { newWalletId: 'other', chainId: 'bitcoin', fromAddress: 'legacy-0', txid: 'tx' })).toBe(false);
        expect(markMigrationSwept('none', { newWalletId: 'new', chainId: 'bitcoin', fromAddress: 'legacy-0', txid: 'tx' })).toBe(false);
        expect(readMigrationSweeps('old').rows.every((row) => !row.swept)).toBe(true);
    });

    it('is pending until every row is swept, then stops offering the list', () => {
        recordMigration('old', 'new');
        setMigrationRows('old', 'new', ROWS);
        for (const row of ROWS.slice(0, 2)) {
            markMigrationSwept('old', { newWalletId: 'new', ...row, txid: `tx-${row.fromAddress}` });
            expect(pendingMigrationSweeps('old')).not.toBeNull();
        }
        markMigrationSwept('old', { newWalletId: 'new', ...ROWS[2], txid: 'tx-ltc' });
        expect(pendingMigrationSweeps('old')).toBeNull();
        expect(readMigrationSweeps('old').rows.every((row) => row.swept)).toBe(true);
    });

    it('a fresh upgrade replaces the earlier record', () => {
        recordMigration('old', 'new-1');
        setMigrationRows('old', 'new-1', ROWS);
        recordMigration('old', 'new-2');
        expect(readMigrationSweeps('old')).toEqual({ newWalletId: 'new-2', listed: false, rows: [] });
        // A late list write from the replaced pair is refused.
        setMigrationRows('old', 'new-1', ROWS);
        expect(readMigrationSweeps('old').newWalletId).toBe('new-2');
    });

    it('dismissal drops the record', () => {
        recordMigration('old', 'new');
        setMigrationRows('old', 'new', ROWS);
        dismissMigrationSweeps('old');
        expect(readMigrationSweeps('old')).toBeNull();
        expect(localStorage.getItem(MIGRATION_SWEEPS_STORAGE_KEY)).toBeNull();
    });

    it('announces each write to subscribers', () => {
        let calls = 0;
        const stop = subscribeMigrationSweeps(() => { calls += 1; });
        recordMigration('old', 'new');
        setMigrationRows('old', 'new', ROWS);
        stop();
        recordMigration('old', 'new');
        expect(calls).toBe(2);
    });
});

describe('migration sweep list leaves with its wallets', () => {
    it('removing the legacy wallet clears its list and keeps other pairs', () => {
        recordMigration('old', 'new');
        recordMigration('other-old', 'other-new');
        clearRemovedWalletStorage('old');
        expect(readMigrationSweeps('old')).toBeNull();
        expect(readMigrationSweeps('other-old')).not.toBeNull();
    });

    it('removing the destination wallet clears the list that sweeps into it', () => {
        recordMigration('old', 'new');
        clearRemovedWalletStorage('new');
        expect(readMigrationSweeps('old')).toBeNull();
    });

    it('a full wipe clears every list', async () => {
        recordMigration('old', 'new');
        recordMigration('other-old', 'other-new');
        await wipeWalletStorage();
        expect(localStorage.getItem(MIGRATION_SWEEPS_STORAGE_KEY)).toBeNull();
        expect(readMigrationSweeps('other-old')).toBeNull();
    });
});
