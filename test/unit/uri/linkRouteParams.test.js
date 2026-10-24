// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Deep-link routing of coin-scheme links that name a token or another network,
// and of token amounts with more than eight decimals.

import { describe, expect, it } from 'vitest';
import { registry as registryLib } from '@xchain-wallet/core';
import { deepLinkRoute, INVALID_DEEP_LINK_MESSAGE } from '../../../packages/desktop/renderer/deepLinkRoute.js';

const registry = registryLib.defaultRegistry();
const ADDR = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const INVALID = { view: 'deep-link-error', message: INVALID_DEEP_LINK_MESSAGE };

describe('coin-scheme links that name a token or a network', () => {
    it('prefills the named token instead of the coin', () => {
        const route = deepLinkRoute(`bitcoin:${ADDR}?tick=pepe&amount=0.5`, registry);
        expect(route.view).toBe('send');
        expect(route.sendPrefill.tick).toBe('PEPE');
        expect(route.sendPrefill.amount).toBe('0.5');
    });

    it('refuses a link whose named network is not the scheme chain', () => {
        expect(deepLinkRoute(`bitcoin:${ADDR}?chain=litecoin-mainnet&amount=1`, registry)).toEqual(INVALID);
        expect(deepLinkRoute(`bitcoin:${ADDR}?chain=bitcoin-mainnet&amount=1`, registry).view).toBe('send');
    });

    it('refuses a token that is not a valid ticker', () => {
        expect(deepLinkRoute(`bitcoin:${ADDR}?tick=${encodeURIComponent('BTCа')}&amount=1`, registry)).toEqual(INVALID);
    });
});

describe('xchain link token amounts', () => {
    it('keeps up to 18 decimals when a token is named', () => {
        const route = deepLinkRoute(`xchain:BTC/send?to=${ADDR}&tick=PEPE&amount=0.123456789012`, registry);
        expect(route.view).toBe('send');
        expect(route.sendPrefill.amount).toBe('0.123456789012');
    });

    it('still limits a coin amount to 8 decimals', () => {
        expect(deepLinkRoute(`xchain:BTC/send?to=${ADDR}&amount=0.123456789`, registry)).toEqual(INVALID);
    });
});
