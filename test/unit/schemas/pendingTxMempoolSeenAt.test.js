// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PendingTx v3 `mempoolSeenAt` (§4 M2.2, ruling I-25).
//
// THE FAILURE THIS PINS is an unloadable vault, and it is not hypothetical:
// `validatePendingTx` hard-asserts `schemaVersion === CURRENT_VERSION`, so the
// moment the constant moved to 3 every PendingTx already sitting in a user's
// vault became invalid. The migration is the ONLY thing that keeps them
// loadable, which is why the tests below build a real v2 record and drive it
// through `migratePendingTx` and then `validatePendingTx`, in that order. A
// test that constructs a v3 record directly proves nothing about a vault
// written by the shipped v2 wallet.

import { describe, it, expect } from 'vitest';

import {
    CURRENT_VERSION,
    createPendingTx,
    validatePendingTx,
} from '../../../packages/core/src/schemas/pendingTx.js';
import {
    migratePendingTx,
    pendingTxMigrations,
} from '../../../packages/core/src/schemas/migrations.js';

// A PendingTx exactly as the shipped v2 wallet wrote it: every v2 field
// present, no `mempoolSeenAt` anywhere, mid-flight so it is a record that
// genuinely still matters after the upgrade.
function v2Record(over = {}) {
    return {
        schemaVersion: 2,
        id: '7c1f0f52-0a4e-4e4c-9a1b-2b8e2f4d0c11',
        chain: 'bitcoin',
        network: 'testnet',
        fromAddress: 'tb1qexamplesource',
        toAddress: 'tb1qexampledest',
        action: 'SEND',
        actionSummary: 'Send 1 PEPECREATURE',
        psbtHex: '70736274ff',
        txHex: '0200000001',
        txid: 'aa11bb22cc33dd44ee55ff6600771122334455667788990011223344556677889',
        status: 'broadcast',
        createdAt: '2026-08-27T12:00:00.000Z',
        broadcastAt: '2026-08-27T12:00:05.000Z',
        confirmedAt: null,
        rbfReplacement: null,
        error: null,
        tick: 'PEPECREATURE',
        amount: '1',
        params: null,
        ...over,
    };
}

describe('PendingTx v3: mempoolSeenAt', () => {
    it('is at version 3', () => {
        expect(CURRENT_VERSION).toBe(3);
    });

    it('createPendingTx seeds mempoolSeenAt null: nothing has been sent yet', () => {
        const tx = createPendingTx({
            chain: 'bitcoin',
            network: 'testnet',
            fromAddress: 'tb1qexamplesource',
            toAddress: 'tb1qexampledest',
            action: 'SEND',
            actionSummary: 'Send 1 PEPECREATURE',
            psbtHex: '70736274ff',
        });
        expect(tx.schemaVersion).toBe(3);
        expect(tx.mempoolSeenAt).toBe(null);
        expect(validatePendingTx(tx).ok).toBe(true);
    });

    it('accepts an ISO sighting and rejects a non-timestamp', () => {
        const stamped = { ...v2Record({ schemaVersion: 3 }), mempoolSeenAt: '2026-08-27T12:01:20.000Z' };
        expect(validatePendingTx(stamped).ok).toBe(true);

        const junk = { ...v2Record({ schemaVersion: 3 }), mempoolSeenAt: 'soon' };
        const r = validatePendingTx(junk);
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('mempoolSeenAt'))).toBe(true);
    });
});

describe('PendingTx v2 -> v3 migration (the vault-loadability path)', () => {
    it('a real v2 record migrates and then VALIDATES', () => {
        const legacy = v2Record();
        // The precondition the whole row rests on: the untouched v2 record is
        // rejected outright, so nothing but the migration saves it.
        expect(validatePendingTx(legacy).ok).toBe(false);

        const migrated = migratePendingTx(legacy);
        expect(migrated.schemaVersion).toBe(3);
        expect(migrated.mempoolSeenAt).toBe(null);

        const r = validatePendingTx(migrated);
        expect(r.ok).toBe(true);
        expect(r.errors).toEqual([]);
    });

    it('seeds null rather than back-dating a sighting the wallet never had', () => {
        // broadcastAt is the tempting thing to copy, and copying it would make
        // the timeline claim the network reported a transaction it may never
        // have received.
        const migrated = migratePendingTx(v2Record());
        expect(migrated.mempoolSeenAt).toBe(null);
        expect(migrated.mempoolSeenAt).not.toBe(migrated.broadcastAt);
    });

    it('carries every v2 field across untouched', () => {
        const legacy = v2Record();
        const migrated = migratePendingTx(legacy);
        for (const key of Object.keys(legacy)) {
            if (key === 'schemaVersion') continue;
            expect(migrated[key]).toEqual(legacy[key]);
        }
    });

    it('preserves a mempoolSeenAt a forward-written record already carries', () => {
        const seen = '2026-08-27T12:01:20.000Z';
        const migrated = pendingTxMigrations[2]({ ...v2Record(), mempoolSeenAt: seen });
        expect(migrated.mempoolSeenAt).toBe(seen);
    });

    it('walks a v1 record all the way to a valid v3', () => {
        const { tick: _t, amount: _a, params: _p, ...v1 } = v2Record({ schemaVersion: 1 });
        const migrated = migratePendingTx(v1);
        expect(migrated.schemaVersion).toBe(3);
        expect(migrated.tick).toBe(null);
        expect(migrated.mempoolSeenAt).toBe(null);
        expect(validatePendingTx(migrated).ok).toBe(true);
    });
});
