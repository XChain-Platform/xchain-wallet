// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Check each ICU select branch renders the sentence its inline English fallback did.

import { describe, expect, test } from 'vitest';

import { format } from '../../packages/core/src/i18n/index.js';
import { en } from '../../packages/core/src/i18n/locales/en/index.js';

const render = (key, vars) => format(en[key], vars);

describe('translation variable selects keep the English the inline fallbacks produced', () => {
    test('amount field input switch', () => {
        const key = 'components.amountField.switchInputTo';
        expect(render(key, { unitState: 'named', value: 'BTC' })).toBe('Switch input to BTC');
        expect(render(key, { unitState: 'unnamed', value: undefined })).toBe('Switch input to coin');
    });

    test('confirm page label', () => {
        const key = 'components.confirmActionModal.confirm';
        expect(render(key, { nameState: 'named', value: 'Send 1 BTC' })).toBe('Confirm Send 1 BTC');
        expect(render(key, { nameState: 'unnamed', value: '' })).toBe('Confirm action');
    });

    test('auto pay switch', () => {
        const key = 'components.openOrdersPanel.coinpayAutoPay';
        expect(render(key, { autoPayState: 'on' })).toBe('Auto pay on');
        expect(render(key, { autoPayState: 'off' })).toBe('Auto pay off (notify-only)');
    });

    test('order book price pick', () => {
        const key = 'components.orderbookPanel.pickPrice';
        expect(render(key, { sideState: 'bid', displayPrice: '10' })).toBe('Pick buy bid price 10');
        expect(render(key, { sideState: 'ask', displayPrice: '11' })).toBe('Pick sell ask price 11');
    });

    test('recovery phrase test note', () => {
        const key = 'settings.backup.enterTheRecoveryPhraseFrom';
        expect(render(key, { countState: 'number', value: 20 })).toMatch(/rebuilds the first 20 addresses on every/);
        expect(render(key, { countState: 'selected', value: NaN })).toMatch(/rebuilds the first selected addresses on every/);
    });

    test('hardware account added line', () => {
        const key = 'hardwareManage.waitingLine';
        expect(render(key, { nameState: 'named', name: 'Cold' })).toMatch(/^Cold is added\. /);
        expect(render(key, { nameState: 'unnamed', name: undefined })).toMatch(/^The account is added\. /);
    });
});
