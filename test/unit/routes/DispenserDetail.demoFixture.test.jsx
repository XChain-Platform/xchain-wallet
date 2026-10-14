// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A demo wallet's dispenser detail renders from the fixture row and makes no
// explorer or chain read, so the EXAMPLE dispenser row never 404s.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, act as domAct, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';
import { markDemoWallet, clearDemoWalletId } from '../../../packages/core/src/flows/demoMode.js';

const CHAIN = 'bitcoin-mainnet';
const WALLET = 'demo-wallet-1';
const ADDRESS = {
    id: 'a1', address: 'bc1qdemoownerownerownerownerownerownerowne', publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 's1', chainId: CHAIN,
};

afterEach(() => { cleanup(); clearDemoWalletId(); });

describe('DispenserDetail for a demo wallet', () => {
    it('renders the fixture dispenser without any explorer or chain read', async () => {
        markDemoWallet(WALLET);
        const reads = [];
        const spy = (name, value) => (...args) => { reads.push(name); return Promise.resolve(value(...args)); };
        const target = {
            getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: () => Promise.resolve({}),
            getSettings: () => Promise.resolve({ walletMode: 'full' }),
            signerReady: () => Promise.resolve({ ready: true }),
            getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
            getDispenserByActionIndex: spy('getDispenserByActionIndex', () => { throw new Error('404'); }),
            getDispenses: spy('getDispenses', () => ({ data: [] })),
            getDispenserLifecycle: spy('getDispenserLifecycle', () => ({ data: [] })),
            getTokenInfo: spy('getTokenInfo', () => { throw new Error('404'); }),
            getListByActionIndex: spy('getListByActionIndex', () => null),
            getChainTipBlockTime: spy('getChainTipBlockTime', () => ({})),
        };
        const messaging = new Proxy(target, {
            get: (t, p) => (p in t ? t[p] : () => Promise.resolve({})),
        });
        let utils;
        await domAct(async () => {
            utils = render(React.createElement(
                MessagingProvider, { shell: 'web', messaging },
                React.createElement(DispenserDetail, {
                    walletId: WALLET, chainId: CHAIN, actionIndex: '4198220',
                    onBack() {}, onCanceled() {}, onOpenAgain() {},
                }),
            ));
            for (let i = 0; i < 24; i += 1) await Promise.resolve();
        });
        expect(utils.container.textContent).toContain('EXAMPLE');
        expect(utils.container.textContent).not.toContain('Action not found');
        expect(reads).toEqual([]);
        vi.restoreAllMocks();
    });
});
