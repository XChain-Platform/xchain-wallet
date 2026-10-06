// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PendingTx `rbf`: the per-send replaceability flag the Bitcoin and Litecoin
// clause of the RBF/cancel UX needs. It is additive, so a record written
// before it must still validate and must read as unknown, never as false.

import { describe, it, expect } from 'vitest';

import { createPendingTx, validatePendingTx } from '../../../packages/core/src/schemas/pendingTx.js';
import { pendingTxToEntry } from '../../../packages/core/src/shared/utils/pendingHistory.js';

const base = {
    chain: 'bitcoin',
    network: 'mainnet',
    fromAddress: 'bc1qfrom',
    toAddress: 'bc1qto',
    action: 'SEND',
    actionSummary: 'send',
    psbtHex: '70736274ff',
};

const entryFor = (record) => pendingTxToEntry({
    chainId: 'bitcoin', address: 'bc1qfrom', pendingTx: record, ownAddresses: new Set(['bc1qfrom']), observedAtMs: 1,
});

describe('PendingTx rbf flag', () => {
    it('records true and false exactly as given', () => {
        expect(createPendingTx({ ...base, rbf: true }).rbf).toBe(true);
        expect(createPendingTx({ ...base, rbf: false }).rbf).toBe(false);
    });

    it('is null when the caller did not say, and still validates', () => {
        const rec = createPendingTx(base);
        expect(rec.rbf).toBeNull();
        expect(validatePendingTx(rec).ok).toBe(true);
    });

    it('validates a record that predates the field', () => {
        const rec = createPendingTx(base);
        delete rec.rbf;
        expect(validatePendingTx(rec).ok).toBe(true);
    });

    it('rejects a non-boolean flag', () => {
        for (const bad of ['true', 1, {}]) {
            const rec = { ...createPendingTx(base), rbf: bad };
            expect(validatePendingTx(rec).ok).toBe(false);
        }
    });

    it('carries the flag onto the history entry, null when unrecorded', () => {
        const mk = (rbf) => {
            const rec = { ...createPendingTx(base), txid: 'ab'.repeat(32), status: 'broadcast' };
            if (rbf !== undefined) rec.rbf = rbf;
            return entryFor(rec);
        };
        expect(mk(true).pending.rbf).toBe(true);
        expect(mk(false).pending.rbf).toBe(false);
        expect(mk(undefined).pending.rbf).toBeNull();
    });
});
