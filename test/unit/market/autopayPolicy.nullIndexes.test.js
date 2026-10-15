// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { orientMatch } from '../../../packages/core/src/market/autopayPolicy.js';

const AMOUNTS = {
    give_amount: '0.5',
    get_amount: '100',
};

describe('market/autopayPolicy nullable match indexes', () => {
    it('orients a triggering order when the counterparty index is null', () => {
        expect(orientMatch({
            ...AMOUNTS,
            give_action_index: null,
            get_action_index: '500',
        }, '500')).toEqual({ coinFill: '0.5', tokenFill: '100' });
    });

    it('orients a counterparty order when the triggering index is null', () => {
        expect(orientMatch({
            ...AMOUNTS,
            give_action_index: '500',
            get_action_index: null,
        }, '500')).toEqual({ coinFill: '100', tokenFill: '0.5' });
    });
});
