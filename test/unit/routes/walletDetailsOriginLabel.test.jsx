// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: Wallet details names every stored wallet origin with its own
// locale dictionary label, never the raw value, and no label names a
// network or a coin.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act as domAct } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { WalletDetails } from '../../../packages/core/src/shared/routes/WalletDetails.jsx';
import { walletOriginLabel } from '../../../packages/core/src/shared/utils/walletOriginLabel.js';
import { WALLET_ORIGINS } from '../../../packages/core/src/schemas/wallet.js';
import { en } from '../../../packages/core/src/i18n/locales/en/index.js';

afterEach(() => cleanup());

const NETWORK_OR_COIN = /\b(bitcoin|litecoin|dogecoin|btc|ltc|doge|mainnet|testnet|regtest)\b/i;
const originValues = Object.entries(en)
    .filter(([key]) => key.startsWith('walletDetails.originLabel.'))
    .map(([, value]) => value);

async function originRowText(origin) {
    const wallet = { id: 'w1', name: 'Origin wallet', format: 'bip39', origin, passphraseEnabled: false };
    const target = {
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        listAccounts: () => Promise.resolve([]),
        listWallets: () => Promise.resolve([wallet]),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            return prop in t ? t[prop] : () => Promise.resolve(undefined);
        },
    });
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(WalletDetails, { walletId: wallet.id, onBack() {} }),
            ),
        );
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    const label = [...utils.container.querySelectorAll('dt')].find((dt) => dt.textContent === en['walletDetails.origin']);
    return label?.nextElementSibling?.textContent ?? null;
}

describe('wallet origin labels', () => {
    it('gives every schema origin its own dictionary label', () => {
        const labels = WALLET_ORIGINS.map((origin) => walletOriginLabel(origin));
        expect(new Set(labels).size).toBe(WALLET_ORIGINS.length);
        for (const [index, origin] of WALLET_ORIGINS.entries()) {
            expect(originValues).toContain(labels[index]);
            expect(labels[index]).not.toBe(origin);
            expect(labels[index]).not.toBe(walletOriginLabel(undefined));
        }
    });

    it('reads an unknown or missing origin as not recorded, never the raw value', () => {
        const fallback = walletOriginLabel(undefined);
        expect(originValues).toContain(fallback);
        expect(walletOriginLabel('legacy-thing')).toBe(fallback);
        expect(walletOriginLabel('constructor')).toBe(fallback);
        expect(walletOriginLabel(null)).toBe(fallback);
    });

    it('names no network or coin in any origin label', () => {
        expect(originValues.length).toBeGreaterThan(WALLET_ORIGINS.length);
        for (const value of originValues) expect(value).not.toMatch(NETWORK_OR_COIN);
    });

    it.each(WALLET_ORIGINS.map((origin) => [origin]))('Wallet details shows the label for %s', async (origin) => {
        const text = await originRowText(origin);
        expect(text).toBe(walletOriginLabel(origin));
        expect(text).not.toBe(origin);
    });
});
