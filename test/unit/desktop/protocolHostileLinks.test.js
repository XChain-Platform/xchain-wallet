// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Hostile payment links handed to the desktop protocol boundary must never
// throw in main, never reach the renderer as a parsed intent when they are
// unusable, and never map to a form the user could sign without seeing.

import { describe, expect, it } from 'vitest';
import { registry as registryLib } from '@xchain-wallet/core';
import { classifyDeepLink } from '../../../packages/desktop/main/protocol.js';
import { deepLinkRoute } from '../../../packages/desktop/renderer/deepLinkRoute.js';

const registry = registryLib.defaultRegistry();
const ADDR = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const bidi = encodeURIComponent('‮gnp.exe');

const REFUSED = [
    `bitcoin:${ADDR}?amount=-1`,
    `bitcoin:${ADDR}?amount=1e3`,
    `bitcoin:${ADDR}?amount=0.123456789`,
    `bitcoin:${ADDR}?amount=1&amount=2`,
    `bitcoin:${ADDR}?amount=1%zz`,
    `bitcoin:${ADDR}?REQ-x=1`,
    `bitcoin:${ADDR}?message=${'A'.repeat(10_000)}`,
    `xchain:BTC/send?to=${ADDR}&amount=1&REQ-x=1`,
    `xchain:BTC/send?to=${ADDR}&amount=1&amount=2`,
];

describe('hostile links at the desktop protocol boundary', () => {
    it.each(REFUSED)('refuses %s without throwing', (raw) => {
        const event = classifyDeepLink(raw);
        expect(event.parsed).toBeNull();
        expect(deepLinkRoute(raw, registry)).toMatchObject({ view: 'deep-link-error' });
    });

    it('refuses a look-alike ticker in the renderer even though main passes the intent on', () => {
        const raw = `xchain:BTC/send?to=${ADDR}&tick=${encodeURIComponent('BTC\u0430')}`;
        expect(deepLinkRoute(raw, registry)).toMatchObject({ view: 'deep-link-error' });
    });

    it('neutralizes bidi text in a memo before it reaches the form', () => {
        const route = deepLinkRoute(`bitcoin:${ADDR}?amount=1&message=${bidi}`, registry);
        expect(route.sendPrefill.memo).not.toMatch(/‮/);
    });
});
