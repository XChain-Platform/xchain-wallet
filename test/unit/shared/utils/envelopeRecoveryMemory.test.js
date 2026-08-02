// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: envelope commit-recovery records ( §3.5, ).
//
// The tests that carry the weight here are the FAILURE ones. §3.5 requires the
// cancel to be reconstructible from persisted state alone, so a write that
// silently does nothing is indistinguishable, to the caller, from a write that
// worked, right up until the commit is broadcast and the coin is unreachable.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    recordPendingCommit,
    listPendingCommits,
    clearPendingCommit,
} from '../../../../packages/core/src/shared/utils/envelopeRecoveryMemory.js';

const REC = {
    commitTxid: 'aa'.repeat(32),
    commitVout: 0,
    commitValue: 12345,
    commitAddress: 'bcrt1pexampleaddress',
    internalKeyPath: "m/86'/1'/0'/0/7",
    tapleafHash: 'cc'.repeat(32),
    coin: 'BTC',
};

describe('envelopeRecoveryMemory', () => {
    beforeEach(() => { localStorage.clear(); });
    afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

    it('persists a record and reads it back whole', () => {
        recordPendingCommit(REC);
        const [got] = listPendingCommits();
        for (const k of Object.keys(REC)) expect(got[k]).toEqual(REC[k]);
        expect(got.createdAt).toBeTypeOf('number');
    });

    it('REFUSES any record missing a field the §3.5 cancel needs', () => {
        for (const field of ['commitTxid', 'commitVout', 'commitValue',
                             'commitAddress', 'internalKeyPath', 'tapleafHash']) {
            const bad = { ...REC };
            delete bad[field];
            expect(() => recordPendingCommit(bad)).toThrow(new RegExp(field));
        }
        expect(listPendingCommits()).toHaveLength(0);
    });

    it('REFUSES a non-record outright', () => {
        for (const bad of [null, undefined, 'x', 42, []])
            expect(() => recordPendingCommit(bad)).toThrow();
    });

    it('THROWS when the write does not survive, so the caller never broadcasts', () => {
        // private-mode stubs and quota rejections both accept setItem and keep
        // nothing; a silent success here is exactly how funds get stranded
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
        expect(() => recordPendingCommit(REC)).toThrow(/did not survive|do not broadcast/i);
    });

    it('THROWS when setItem itself rejects (quota), rather than swallowing it', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        expect(() => recordPendingCommit(REC)).toThrow();
    });

    it('a replaced commit (RBF) REPLACES its record instead of duplicating it', () => {
        // §3.5: the record must track the CURRENT commit; a stale one is the bug
        recordPendingCommit(REC);
        recordPendingCommit({ ...REC, commitValue: 99999 });
        const all = listPendingCommits();
        expect(all).toHaveLength(1);
        expect(all[0].commitValue).toBe(99999);
    });

    it('keeps distinct outpoints apart and lists them oldest first', () => {
        recordPendingCommit({ ...REC, createdAt: 200 });
        recordPendingCommit({ ...REC, commitVout: 1, createdAt: 100 });
        const all = listPendingCommits();
        expect(all).toHaveLength(2);
        expect(all[0].createdAt).toBe(100);
    });

    it('clears a record once the reveal has landed', () => {
        recordPendingCommit(REC);
        expect(clearPendingCommit(REC.commitTxid, 0)).toHaveLength(0);
        expect(listPendingCommits()).toHaveLength(0);
    });

    it('a corrupt blob reads as "nothing on record" rather than throwing', () => {
        // a broken store must not make the recovery UI unusable
        localStorage.setItem('xc:envelopeCommits', '{not json');
        expect(listPendingCommits()).toEqual([]);
        localStorage.setItem('xc:envelopeCommits', '{"not":"an array"}');
        expect(listPendingCommits()).toEqual([]);
    });

    it('stores no secret: the derivation PATH, never a key', () => {
        recordPendingCommit(REC);
        const raw = localStorage.getItem('xc:envelopeCommits');
        expect(raw).toContain("m/86'/1'/0'/0/7");
        for (const k of ['privateKey', 'wif', 'seed', 'mnemonic', 'internalPrivkey'])
            expect(raw).not.toContain(k);
    });
});
