// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Unit: schemas/pendingTx — createPendingTx + validatePendingTx.

import { describe, it, expect } from 'vitest';
import {
    createPendingTx,
    validatePendingTx,
    PENDING_TX_STATUSES,
    CURRENT_VERSION,
} from '../../../packages/core/src/schemas/pendingTx.js';

const BASE_INPUT = {
    chain: 'BTC',
    network: 'mainnet',
    fromAddress: '1fromAddr',
    toAddress: '1toAddr',
    action: 'SEND',
    actionSummary: 'Send 1 BTC',
    psbtHex: '70736274ff',
};

describe('PENDING_TX_STATUSES', () => {
    it('contains expected statuses', () => {
        expect(PENDING_TX_STATUSES).toContain('composing');
        expect(PENDING_TX_STATUSES).toContain('broadcast');
        expect(PENDING_TX_STATUSES).toContain('indexed');
        expect(PENDING_TX_STATUSES).toContain('failed');
        expect(PENDING_TX_STATUSES).toContain('rbf-replaced');
    });
});

describe('createPendingTx', () => {
    it('creates a well-formed record', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(tx.schemaVersion).toBe(CURRENT_VERSION);
        expect(typeof tx.id).toBe('string');
        expect(tx.chain).toBe('BTC');
        expect(tx.network).toBe('mainnet');
        expect(tx.fromAddress).toBe('1fromAddr');
        expect(tx.toAddress).toBe('1toAddr');
        expect(tx.action).toBe('SEND');
        expect(tx.actionSummary).toBe('Send 1 BTC');
        expect(tx.psbtHex).toBe('70736274ff');
        expect(tx.txHex).toBeNull();
        expect(tx.txid).toBeNull();
        expect(tx.status).toBe('composing');
        expect(typeof tx.createdAt).toBe('string');
        expect(tx.broadcastAt).toBeNull();
        expect(tx.confirmedAt).toBeNull();
        expect(tx.rbfReplacement).toBeNull();
        expect(tx.error).toBeNull();
    });

    it('generates unique ids', () => {
        const t1 = createPendingTx(BASE_INPUT);
        const t2 = createPendingTx(BASE_INPUT);
        expect(t1.id).not.toBe(t2.id);
    });

    it('passes validation immediately after creation', () => {
        const r = validatePendingTx(createPendingTx(BASE_INPUT));
        expect(r.ok).toBe(true);
    });
});

describe('validatePendingTx', () => {
    it('accepts a valid record', () => {
        const r = validatePendingTx(createPendingTx(BASE_INPUT));
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
    });

    it('rejects non-object input', () => {
        expect(validatePendingTx(null).ok).toBe(false);
        expect(validatePendingTx('x').ok).toBe(false);
    });

    it('rejects wrong schemaVersion', () => {
        const tx = createPendingTx(BASE_INPUT);
        const r = validatePendingTx({ ...tx, schemaVersion: 99 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
    });

    it('rejects empty chain', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, chain: '' }).ok).toBe(false);
    });

    it('rejects invalid network', () => {
        const tx = createPendingTx(BASE_INPUT);
        const r = validatePendingTx({ ...tx, network: 'devnet' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('network'))).toBe(true);
    });

    it('accepts all valid networks', () => {
        const tx = createPendingTx(BASE_INPUT);
        for (const network of ['mainnet', 'testnet', 'regtest']) {
            expect(validatePendingTx({ ...tx, network }).ok).toBe(true);
        }
    });

    it('rejects empty fromAddress', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, fromAddress: '' }).ok).toBe(false);
    });

    it('rejects empty toAddress', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, toAddress: '' }).ok).toBe(false);
    });

    it('rejects empty action', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, action: '' }).ok).toBe(false);
    });

    it('rejects non-string actionSummary', () => {
        const tx = createPendingTx(BASE_INPUT);
        const r = validatePendingTx({ ...tx, actionSummary: 42 });
        expect(r.ok).toBe(false);
    });

    it('accepts empty actionSummary string', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, actionSummary: '' }).ok).toBe(true);
    });

    it('rejects non-string psbtHex', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, psbtHex: 42 }).ok).toBe(false);
    });

    it('accepts null txHex', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, txHex: null }).ok).toBe(true);
    });

    it('accepts string txHex', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, txHex: 'deadbeef' }).ok).toBe(true);
    });

    it('accepts null txid', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, txid: null }).ok).toBe(true);
    });

    it('accepts non-null txid', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, txid: 'abc123' }).ok).toBe(true);
    });

    it('rejects empty string txid', () => {
        const tx = createPendingTx(BASE_INPUT);
        const r = validatePendingTx({ ...tx, txid: '' });
        expect(r.ok).toBe(false);
    });

    it('rejects invalid status', () => {
        const tx = createPendingTx(BASE_INPUT);
        const r = validatePendingTx({ ...tx, status: 'unknown' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('status'))).toBe(true);
    });

    it('accepts all valid statuses', () => {
        const tx = createPendingTx(BASE_INPUT);
        for (const status of PENDING_TX_STATUSES) {
            expect(validatePendingTx({ ...tx, status }).ok).toBe(true);
        }
    });

    it('rejects invalid broadcastAt', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, broadcastAt: 'bad' }).ok).toBe(false);
    });

    it('accepts null broadcastAt', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, broadcastAt: null }).ok).toBe(true);
    });

    it('accepts valid broadcastAt timestamp', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, broadcastAt: new Date().toISOString() }).ok).toBe(true);
    });

    it('rejects invalid confirmedAt', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, confirmedAt: 'bad' }).ok).toBe(false);
    });

    it('accepts null confirmedAt', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, confirmedAt: null }).ok).toBe(true);
    });

    it('accepts null rbfReplacement', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, rbfReplacement: null }).ok).toBe(true);
    });

    it('accepts non-null rbfReplacement', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, rbfReplacement: 'txid-replace' }).ok).toBe(true);
    });

    it('accepts null error', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, error: null }).ok).toBe(true);
    });

    it('accepts string error', () => {
        const tx = createPendingTx(BASE_INPUT);
        expect(validatePendingTx({ ...tx, error: 'network timeout' }).ok).toBe(true);
    });

    it('rejects non-string non-null error', () => {
        const tx = createPendingTx(BASE_INPUT);
        // error is validated via isNullableString — non-string-non-null should fail
        const r = validatePendingTx({ ...tx, error: 42 });
        expect(r.ok).toBe(false);
    });
});
