// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: schemas/signer — createSignerRecord + validateSignerRecord.

import { describe, it, expect } from 'vitest';
import {
    createSignerRecord,
    validateSignerRecord,
    SIGNER_KINDS,
    CURRENT_VERSION,
} from '../../../packages/core/src/schemas/signer.js';

const BASE_INPUT = {
    walletId: 'wallet-1',
    kind: 'trezor',
    vendor: 'trezor',
    model: 'T2T1',
    deviceIdentifier: 'device-abc',
};

describe('SIGNER_KINDS', () => {
    it('contains trezor and ledger', () => {
        expect(SIGNER_KINDS).toContain('trezor');
        expect(SIGNER_KINDS).toContain('ledger');
        expect(SIGNER_KINDS).toHaveLength(2);
    });
});

describe('createSignerRecord', () => {
    it('creates a well-formed trezor signer', () => {
        const s = createSignerRecord(BASE_INPUT);
        expect(s.schemaVersion).toBe(CURRENT_VERSION);
        expect(typeof s.id).toBe('string');
        expect(s.walletId).toBe('wallet-1');
        expect(s.kind).toBe('trezor');
        expect(s.vendor).toBe('trezor');
        expect(s.model).toBe('T2T1');
        expect(s.deviceIdentifier).toBe('device-abc');
        expect(s.label).toBe('Trezor');
        expect(s.firmwareVersion).toBeNull();
        expect(typeof s.pairedAt).toBe('string');
        expect(s.pairedAt).toBe(s.lastSeenAt);
    });

    it('defaults label to "Trezor" for trezor kind', () => {
        const s = createSignerRecord(BASE_INPUT);
        expect(s.label).toBe('Trezor');
    });

    it('defaults label to "Ledger" for ledger kind', () => {
        const s = createSignerRecord({ ...BASE_INPUT, kind: 'ledger', vendor: 'ledger', model: 'nanoX' });
        expect(s.label).toBe('Ledger');
    });

    it('defaults label to "Hardware signer" for unknown kind', () => {
        // NOTE: The factory does not validate kind — it accepts any string and
        // falls through the defaultLabel else-branch. This is characterization.
        const s = createSignerRecord({ ...BASE_INPUT, kind: 'unknown' });
        expect(s.label).toBe('Hardware signer');
    });

    it('uses provided label', () => {
        const s = createSignerRecord({ ...BASE_INPUT, label: 'My Trezor' });
        expect(s.label).toBe('My Trezor');
    });

    it('defaults firmwareVersion to null', () => {
        const s = createSignerRecord(BASE_INPUT);
        expect(s.firmwareVersion).toBeNull();
    });

    it('uses provided firmwareVersion', () => {
        const s = createSignerRecord({ ...BASE_INPUT, firmwareVersion: '2.5.1' });
        expect(s.firmwareVersion).toBe('2.5.1');
    });

    it('passes validation immediately after creation', () => {
        const r = validateSignerRecord(createSignerRecord(BASE_INPUT));
        expect(r.ok).toBe(true);
    });
});

describe('validateSignerRecord', () => {
    it('accepts a valid record', () => {
        const r = validateSignerRecord(createSignerRecord(BASE_INPUT));
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
    });

    it('rejects non-object input', () => {
        expect(validateSignerRecord(null).ok).toBe(false);
        expect(validateSignerRecord('x').ok).toBe(false);
        expect(validateSignerRecord(42).ok).toBe(false);
    });

    it('rejects wrong schemaVersion', () => {
        const s = createSignerRecord(BASE_INPUT);
        const r = validateSignerRecord({ ...s, schemaVersion: 99 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
    });

    it('rejects empty id', () => {
        const s = createSignerRecord(BASE_INPUT);
        expect(validateSignerRecord({ ...s, id: '' }).ok).toBe(false);
    });

    it('rejects empty walletId', () => {
        const s = createSignerRecord(BASE_INPUT);
        expect(validateSignerRecord({ ...s, walletId: '' }).ok).toBe(false);
    });

    it('rejects invalid kind', () => {
        const s = createSignerRecord(BASE_INPUT);
        const r = validateSignerRecord({ ...s, kind: 'usb' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('kind'))).toBe(true);
    });

    it('accepts all valid kinds', () => {
        for (const kind of SIGNER_KINDS) {
            const s = createSignerRecord({ ...BASE_INPUT, kind });
            expect(validateSignerRecord(s).ok).toBe(true);
        }
    });

    it('rejects empty vendor', () => {
        const s = createSignerRecord(BASE_INPUT);
        expect(validateSignerRecord({ ...s, vendor: '' }).ok).toBe(false);
    });

    it('rejects empty model', () => {
        const s = createSignerRecord(BASE_INPUT);
        expect(validateSignerRecord({ ...s, model: '' }).ok).toBe(false);
    });

    it('rejects empty deviceIdentifier', () => {
        const s = createSignerRecord(BASE_INPUT);
        expect(validateSignerRecord({ ...s, deviceIdentifier: '' }).ok).toBe(false);
    });

    it('rejects non-string label', () => {
        const s = createSignerRecord(BASE_INPUT);
        const r = validateSignerRecord({ ...s, label: 42 });
        expect(r.ok).toBe(false);
    });

    it('accepts empty string label', () => {
        const s = createSignerRecord(BASE_INPUT);
        expect(validateSignerRecord({ ...s, label: '' }).ok).toBe(true);
    });

    it('rejects empty string firmwareVersion', () => {
        const s = createSignerRecord(BASE_INPUT);
        const r = validateSignerRecord({ ...s, firmwareVersion: '' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('firmwareVersion'))).toBe(true);
    });

    it('accepts null firmwareVersion', () => {
        const s = createSignerRecord(BASE_INPUT);
        expect(validateSignerRecord({ ...s, firmwareVersion: null }).ok).toBe(true);
    });

    it('accepts non-null firmwareVersion', () => {
        const s = createSignerRecord(BASE_INPUT);
        expect(validateSignerRecord({ ...s, firmwareVersion: '2.6.0' }).ok).toBe(true);
    });

    it('rejects invalid pairedAt', () => {
        const s = createSignerRecord(BASE_INPUT);
        expect(validateSignerRecord({ ...s, pairedAt: 'bad' }).ok).toBe(false);
    });

    it('rejects invalid lastSeenAt', () => {
        const s = createSignerRecord(BASE_INPUT);
        expect(validateSignerRecord({ ...s, lastSeenAt: 'bad' }).ok).toBe(false);
    });
});
