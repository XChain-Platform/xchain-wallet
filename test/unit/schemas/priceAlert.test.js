// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Unit: schemas/priceAlert — createPriceAlert + validatePriceAlert + priceAlertKey.

import { describe, it, expect } from 'vitest';
import {
    createPriceAlert,
    validatePriceAlert,
    priceAlertKey,
    CURRENT_VERSION,
} from '../../../packages/core/src/schemas/priceAlert.js';

const BASE_INPUT = {
    walletId: 'wallet-1',
    chainId: 'bitcoin-mainnet',
    direction: 'above',
    targetFiat: 70000,
    fiatCurrency: 'USD',
};

describe('createPriceAlert', () => {
    it('creates a well-formed armed alert', () => {
        const a = createPriceAlert(BASE_INPUT);
        expect(a.schemaVersion).toBe(CURRENT_VERSION);
        expect(typeof a.id).toBe('string');
        expect(a.walletId).toBe('wallet-1');
        expect(a.chainId).toBe('bitcoin-mainnet');
        expect(a.direction).toBe('above');
        expect(a.targetFiat).toBe(70000);
        expect(a.fiatCurrency).toBe('usd'); // lower-cased
        expect(a.status).toBe('armed');
        expect(a.triggeredAt).toBeNull();
        expect(Number.isFinite(Date.parse(a.createdAt))).toBe(true);
    });

    it('generates unique ids', () => {
        expect(createPriceAlert(BASE_INPUT).id).not.toBe(createPriceAlert(BASE_INPUT).id);
    });

    it('passes validation immediately after creation', () => {
        expect(validatePriceAlert(createPriceAlert(BASE_INPUT)).ok).toBe(true);
    });
});

describe('validatePriceAlert', () => {
    it('accepts a valid armed record', () => {
        const r = validatePriceAlert(createPriceAlert(BASE_INPUT));
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
    });

    it('accepts a triggered record with an ISO triggeredAt', () => {
        const a = { ...createPriceAlert(BASE_INPUT), status: 'triggered', triggeredAt: new Date().toISOString() };
        expect(validatePriceAlert(a).ok).toBe(true);
    });

    it('rejects non-object input', () => {
        expect(validatePriceAlert(null).ok).toBe(false);
        expect(validatePriceAlert('x').ok).toBe(false);
    });

    it('rejects wrong schemaVersion', () => {
        const r = validatePriceAlert({ ...createPriceAlert(BASE_INPUT), schemaVersion: 99 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
    });

    it('rejects an unknown direction', () => {
        const r = validatePriceAlert({ ...createPriceAlert(BASE_INPUT), direction: 'sideways' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('direction'))).toBe(true);
    });

    it('rejects a non-positive targetFiat', () => {
        expect(validatePriceAlert({ ...createPriceAlert(BASE_INPUT), targetFiat: 0 }).ok).toBe(false);
        expect(validatePriceAlert({ ...createPriceAlert(BASE_INPUT), targetFiat: -5 }).ok).toBe(false);
        expect(validatePriceAlert({ ...createPriceAlert(BASE_INPUT), targetFiat: 'x' }).ok).toBe(false);
    });

    it('rejects an unknown status', () => {
        const r = validatePriceAlert({ ...createPriceAlert(BASE_INPUT), status: 'pending' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('status'))).toBe(true);
    });

    it('rejects a non-null, non-ISO triggeredAt', () => {
        expect(validatePriceAlert({ ...createPriceAlert(BASE_INPUT), triggeredAt: 'soon' }).ok).toBe(false);
    });

    it('rejects empty walletId / chainId', () => {
        expect(validatePriceAlert({ ...createPriceAlert(BASE_INPUT), walletId: '' }).ok).toBe(false);
        expect(validatePriceAlert({ ...createPriceAlert(BASE_INPUT), chainId: '' }).ok).toBe(false);
    });
});

describe('priceAlertKey', () => {
    it('builds the canonical key', () => {
        expect(priceAlertKey(createPriceAlert(BASE_INPUT))).toBe('bitcoin-mainnet::above::70000');
    });

    it('differs by direction and target', () => {
        const above = priceAlertKey({ chainId: 'bitcoin-mainnet', direction: 'above', targetFiat: 70000 });
        const below = priceAlertKey({ chainId: 'bitcoin-mainnet', direction: 'below', targetFiat: 70000 });
        const other = priceAlertKey({ chainId: 'bitcoin-mainnet', direction: 'above', targetFiat: 80000 });
        expect(above).not.toBe(below);
        expect(above).not.toBe(other);
    });
});
