// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Unit: schemas/account — createAccount + validateAccount.

import { describe, it, expect } from 'vitest';
import {
    createAccount,
    validateAccount,
    CURRENT_VERSION,
} from '../../../packages/core/src/schemas/account.js';

const BASE_INPUT = {
    walletId: 'wallet-abc',
    name: 'My Account',
    index: 0,
};

describe('createAccount', () => {
    it('creates a well-formed account', () => {
        const a = createAccount(BASE_INPUT);
        expect(a.schemaVersion).toBe(CURRENT_VERSION);
        expect(typeof a.id).toBe('string');
        expect(a.id.length).toBeGreaterThan(0);
        expect(a.walletId).toBe('wallet-abc');
        expect(a.name).toBe('My Account');
        expect(a.index).toBe(0);
        expect(typeof a.createdAt).toBe('string');
        expect(Number.isFinite(Date.parse(a.createdAt))).toBe(true);
    });

    it('generates unique ids per call', () => {
        const a1 = createAccount(BASE_INPUT);
        const a2 = createAccount(BASE_INPUT);
        expect(a1.id).not.toBe(a2.id);
    });

    it('passes validation immediately after creation', () => {
        const r = validateAccount(createAccount(BASE_INPUT));
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
    });

    it('accepts index > 0', () => {
        const a = createAccount({ ...BASE_INPUT, index: 42 });
        expect(a.index).toBe(42);
    });
});

describe('validateAccount', () => {
    it('accepts a valid record', () => {
        const r = validateAccount(createAccount(BASE_INPUT));
        expect(r.ok).toBe(true);
    });

    it('rejects non-object input', () => {
        expect(validateAccount(null).ok).toBe(false);
        expect(validateAccount('string').ok).toBe(false);
        expect(validateAccount(42).ok).toBe(false);
        expect(validateAccount(undefined).ok).toBe(false);
    });

    it('rejects wrong schemaVersion', () => {
        const a = createAccount(BASE_INPUT);
        const r = validateAccount({ ...a, schemaVersion: 99 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
    });

    it('rejects empty id', () => {
        const a = createAccount(BASE_INPUT);
        const r = validateAccount({ ...a, id: '' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('id'))).toBe(true);
    });

    it('rejects empty walletId', () => {
        const a = createAccount(BASE_INPUT);
        const r = validateAccount({ ...a, walletId: '' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('walletId'))).toBe(true);
    });

    it('rejects non-string walletId', () => {
        const a = createAccount(BASE_INPUT);
        const r = validateAccount({ ...a, walletId: 123 });
        expect(r.ok).toBe(false);
    });

    it('rejects empty name', () => {
        const a = createAccount(BASE_INPUT);
        const r = validateAccount({ ...a, name: '' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('name'))).toBe(true);
    });

    it('rejects negative index', () => {
        const a = createAccount(BASE_INPUT);
        const r = validateAccount({ ...a, index: -1 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('index'))).toBe(true);
    });

    it('rejects float index', () => {
        const a = createAccount(BASE_INPUT);
        const r = validateAccount({ ...a, index: 1.5 });
        expect(r.ok).toBe(false);
    });

    it('rejects invalid createdAt', () => {
        const a = createAccount(BASE_INPUT);
        const r = validateAccount({ ...a, createdAt: 'not-a-date' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('createdAt'))).toBe(true);
    });

    it('accepts index 0', () => {
        const a = createAccount(BASE_INPUT);
        const r = validateAccount({ ...a, index: 0 });
        expect(r.ok).toBe(true);
    });
});
