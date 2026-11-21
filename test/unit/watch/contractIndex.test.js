// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import entry from '../../../packages/core/src/watch/contract/schema.json';
import {
    CONTRACT_VERSION,
    schemas,
    validateMessage,
} from '../../../packages/core/src/watch/contract/index.js';

const qrBits = Buffer.alloc(Math.ceil((21 * 21) / 8)).toString('base64');
const snapshot = {
    v: 1,
    builtAt: 1,
    balancesAt: 1,
    pricesAt: 1,
    session: 'unlocked',
    network: { kind: 'mainnet', isTest: false },
    fiatCode: 'USD',
    hidden: false,
    unitDefault: 'fiat',
    walletName: 'Main',
    totals: { fiatText: '$1', unitsText: '1 asset' },
    rows: [],
    capped: false,
    receive: [{
        chainId: 'btc',
        label: 'Bitcoin',
        address: 'bc1qexample',
        qr: { size: 21, bits: qrBits },
    }],
    inbox: [],
    request: {
        id: '0123456789abcdef0123456789abcdef',
        kind: 'request',
        iconHash: '',
        sentence: 'Confirm payment',
        amountText: '1 BTC',
    },
    settings: { showTotal: false, enabled: true },
};

const messages = {
    snapshot,
    detail: { v: 1, tokenId: 'btc' },
    refresh: {},
    detailRequest: { tokenId: 'btc' },
    openOnPhone: { route: '/review' },
    markRead: { id: 'alert-1' },
    watchState: { appVersion: '1.0.0' },
};

describe('watch contract entry', () => {
    it('resolves and validates every message kind', () => {
        expect(CONTRACT_VERSION).toBe(entry.v);
        expect(Object.keys(schemas)).toEqual(Object.keys(entry.messages));
        for (const [kind, value] of Object.entries(messages)) {
            expect(validateMessage(kind, value), kind).toBe(true);
        }
    });

    it('refuses snapshot QR bits whose length disagrees with size', () => {
        const mismatched = structuredClone(snapshot);
        mismatched.receive[0].qr.size = 25;

        expect(validateMessage('snapshot', mismatched)).toBe(false);
    });
});
