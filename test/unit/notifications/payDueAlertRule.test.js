// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { wantsPayDueAlert } from '../../../packages/core/src/notifications/payDueAlert.js';

describe('wantsPayDueAlert', () => {
    it('allows a required payment when the payer explicitly lacks autopay consent', () => {
        expect(wantsPayDueAlert({
            kind: 'coinpay-required',
            role: 'payer',
            hasAutopayConsent: false,
        })).toBe(true);
    });

    it.each([
        ['payer', false],
        ['payee', true],
        ['neutral', undefined],
    ])('allows a manual autopay alert for role %s and consent %s', (role, hasAutopayConsent) => {
        expect(wantsPayDueAlert({
            kind: 'coinpay-autopay-manual',
            role,
            hasAutopayConsent,
        })).toBe(true);
    });

    it('rejects a required payment for a payee', () => {
        expect(wantsPayDueAlert({
            kind: 'coinpay-required',
            role: 'payee',
            hasAutopayConsent: false,
        })).toBe(false);
    });

    it('rejects a required payment for a neutral party', () => {
        expect(wantsPayDueAlert({
            kind: 'coinpay-required',
            role: 'neutral',
            hasAutopayConsent: false,
        })).toBe(false);
    });

    it('rejects a required payment when the payer has autopay consent', () => {
        expect(wantsPayDueAlert({
            kind: 'coinpay-required',
            role: 'payer',
            hasAutopayConsent: true,
        })).toBe(false);
    });

    it.each([undefined, null, 0, 'false'])('rejects non-boolean consent %s', (hasAutopayConsent) => {
        expect(wantsPayDueAlert({
            kind: 'coinpay-required',
            role: 'payer',
            hasAutopayConsent,
        })).toBe(false);
    });

    it('rejects every other alert kind', () => {
        expect(wantsPayDueAlert({
            kind: 'coinpay-complete',
            role: 'payer',
            hasAutopayConsent: false,
        })).toBe(false);
    });

    it('rejects a missing input', () => {
        expect(wantsPayDueAlert()).toBe(false);
    });

    it.each([null, false, 'coinpay-required'])('rejects non-object input %s', (input) => {
        expect(wantsPayDueAlert(input)).toBe(false);
    });
});
