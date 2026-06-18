// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: schemas/connectedSite: createConnectedSite + validateConnectedSite.

import { describe, it, expect } from 'vitest';
import {
    createConnectedSite,
    validateConnectedSite,
    CURRENT_VERSION,
} from '../../../packages/core/src/schemas/connectedSite.js';

const BASE_PERMISSIONS = {
    chains: ['bitcoin-mainnet'],
    accounts: ['acct-1'],
    canSignMessage: false,
    canSignAction: {},
};

const BASE_INPUT = {
    origin: 'https://example.com',
    appName: 'Example dApp',
    permissions: BASE_PERMISSIONS,
};

describe('createConnectedSite', () => {
    it('creates a well-formed connected site', () => {
        const cs = createConnectedSite(BASE_INPUT);
        expect(cs.schemaVersion).toBe(CURRENT_VERSION);
        expect(typeof cs.id).toBe('string');
        expect(cs.origin).toBe('https://example.com');
        expect(cs.appName).toBe('Example dApp');
        expect(cs.appIcon).toBe('');
        expect(typeof cs.connectedAt).toBe('string');
        expect(cs.connectedAt).toBe(cs.lastUsedAt);
        expect(cs.permissions).toEqual(BASE_PERMISSIONS);
        expect(cs.sessionHistory).toEqual([]);
    });

    it('uses provided appIcon', () => {
        const cs = createConnectedSite({ ...BASE_INPUT, appIcon: 'https://example.com/icon.png' });
        expect(cs.appIcon).toBe('https://example.com/icon.png');
    });

    it('defaults appIcon to empty string', () => {
        const cs = createConnectedSite(BASE_INPUT);
        expect(cs.appIcon).toBe('');
    });

    it('passes validation immediately after creation', () => {
        const r = validateConnectedSite(createConnectedSite(BASE_INPUT));
        expect(r.ok).toBe(true);
    });
});

describe('validateConnectedSite', () => {
    it('accepts a valid record', () => {
        const r = validateConnectedSite(createConnectedSite(BASE_INPUT));
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
    });

    it('rejects non-object input', () => {
        expect(validateConnectedSite(null).ok).toBe(false);
        expect(validateConnectedSite(42).ok).toBe(false);
        expect(validateConnectedSite('str').ok).toBe(false);
    });

    it('rejects wrong schemaVersion', () => {
        const cs = createConnectedSite(BASE_INPUT);
        const r = validateConnectedSite({ ...cs, schemaVersion: 99 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
    });

    it('rejects empty origin', () => {
        const cs = createConnectedSite(BASE_INPUT);
        expect(validateConnectedSite({ ...cs, origin: '' }).ok).toBe(false);
    });

    it('rejects empty appName', () => {
        const cs = createConnectedSite(BASE_INPUT);
        const r = validateConnectedSite({ ...cs, appName: '' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('appName'))).toBe(true);
    });

    it('rejects non-string appIcon', () => {
        const cs = createConnectedSite(BASE_INPUT);
        const r = validateConnectedSite({ ...cs, appIcon: null });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('appIcon'))).toBe(true);
    });

    it('rejects invalid connectedAt', () => {
        const cs = createConnectedSite(BASE_INPUT);
        expect(validateConnectedSite({ ...cs, connectedAt: 'bad' }).ok).toBe(false);
    });

    it('rejects invalid lastUsedAt', () => {
        const cs = createConnectedSite(BASE_INPUT);
        expect(validateConnectedSite({ ...cs, lastUsedAt: 'bad' }).ok).toBe(false);
    });

    it('rejects null permissions', () => {
        const cs = createConnectedSite(BASE_INPUT);
        const r = validateConnectedSite({ ...cs, permissions: null });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('permissions'))).toBe(true);
    });

    it('rejects permissions.chains with non-string elements', () => {
        const cs = createConnectedSite(BASE_INPUT);
        const r = validateConnectedSite({
            ...cs,
            permissions: { ...BASE_PERMISSIONS, chains: [42] },
        });
        expect(r.ok).toBe(false);
    });

    it('rejects permissions.accounts with non-string elements', () => {
        const cs = createConnectedSite(BASE_INPUT);
        const r = validateConnectedSite({
            ...cs,
            permissions: { ...BASE_PERMISSIONS, accounts: [null] },
        });
        expect(r.ok).toBe(false);
    });

    it('rejects permissions.canSignMessage as non-boolean', () => {
        const cs = createConnectedSite(BASE_INPUT);
        const r = validateConnectedSite({
            ...cs,
            permissions: { ...BASE_PERMISSIONS, canSignMessage: 'yes' },
        });
        expect(r.ok).toBe(false);
    });

    it('rejects permissions.canSignAction as non-object', () => {
        const cs = createConnectedSite(BASE_INPUT);
        const r = validateConnectedSite({
            ...cs,
            permissions: { ...BASE_PERMISSIONS, canSignAction: null },
        });
        expect(r.ok).toBe(false);
    });

    it('rejects permissions.canSignAction with invalid permission value', () => {
        const cs = createConnectedSite(BASE_INPUT);
        const r = validateConnectedSite({
            ...cs,
            permissions: { ...BASE_PERMISSIONS, canSignAction: { SEND: 'invalid' } },
        });
        expect(r.ok).toBe(false);
    });

    it('accepts permissions with canSignAction values', () => {
        const cs = createConnectedSite(BASE_INPUT);
        const r = validateConnectedSite({
            ...cs,
            permissions: {
                ...BASE_PERMISSIONS,
                canSignAction: { SEND: 'always', RECEIVE: 'ask', BURN: 'never' },
            },
        });
        expect(r.ok).toBe(true);
    });

    it('rejects non-array sessionHistory', () => {
        const cs = createConnectedSite(BASE_INPUT);
        const r = validateConnectedSite({ ...cs, sessionHistory: 'bad' });
        expect(r.ok).toBe(false);
    });

    it('accepts valid session history entries', () => {
        const cs = createConnectedSite(BASE_INPUT);
        const r = validateConnectedSite({
            ...cs,
            sessionHistory: [
                { timestamp: new Date().toISOString(), action: 'connect', approved: true },
            ],
        });
        expect(r.ok).toBe(true);
    });

    it('rejects malformed session history entry: invalid timestamp', () => {
        const cs = createConnectedSite(BASE_INPUT);
        const r = validateConnectedSite({
            ...cs,
            sessionHistory: [{ timestamp: 'bad', action: 'connect', approved: true }],
        });
        expect(r.ok).toBe(false);
    });

    it('rejects malformed session history entry: empty action', () => {
        const cs = createConnectedSite(BASE_INPUT);
        const r = validateConnectedSite({
            ...cs,
            sessionHistory: [{ timestamp: new Date().toISOString(), action: '', approved: true }],
        });
        expect(r.ok).toBe(false);
    });

    it('rejects malformed session history entry: non-boolean approved', () => {
        const cs = createConnectedSite(BASE_INPUT);
        const r = validateConnectedSite({
            ...cs,
            sessionHistory: [{ timestamp: new Date().toISOString(), action: 'connect', approved: 1 }],
        });
        expect(r.ok).toBe(false);
    });
});
