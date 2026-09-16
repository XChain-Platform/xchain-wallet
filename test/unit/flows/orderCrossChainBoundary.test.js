// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Where a cross-chain ORDER (GIVE_COIN != GET_COIN) is authored, and where
// it is not.
//
// The wire permits the two coins to differ: such an order escrows the GIVE
// side locally and is matched + settled by the validator federation
// through CROSS_SETTLE (ORDER.md "Notes"). The flow layer carries the
// param map untouched, signing on the one chain it is given. Exactly one
// surface composes that map, CrossChainOrderForm; the two same-chain
// surfaces (PlaceOrderPanel, CreateOrderForm) still hardcode one coin on
// both sides and point at it.
//
// These pin that split so a same-chain surface cannot quietly grow a
// second chain, and the cross-chain surface cannot quietly lose one.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'order-tx-1' })),
}));
vi.mock('../../../packages/core/src/flows/sendToken.js', () => ({
    normalizeSource: vi.fn((from) => ({
        address: from.address, publicKey: from.publicKey,
        derivationPath: from.derivationPath || null, addressId: from.addressId || null,
    })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { orderAction } from '../../../packages/core/src/flows/orderAction.js';
import { buildCommands } from '../../../packages/core/src/shared/commandPalette/commandRegistry.js';
import { ACTION_ENTRY_DEFS } from '../../../packages/core/src/shared/actionEntries.js';

const FROM = { address: 'addr-1', publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0", addressId: 'a1' };

// Workspace root. `new URL(…, import.meta.url)` is NOT usable here: under
// the Vite transform import.meta.url is not a file: URL, and the dynamic
// form is rewritten as an asset reference that resolves to `undefined`.
// Same cwd-probe fallback as displayPrefs.test.jsx, so the suite runs from
// either the wallet repo or the platform root.
const WORKSPACE_ROOT = existsSync(resolve(process.cwd(), 'packages/core/src/flows/orderAction.js'))
    ? process.cwd()
    : resolve(process.cwd(), 'xchain-wallet');
const SRC = (rel) => join(WORKSPACE_ROOT, rel);
const PLACE_ORDER_PANEL = 'packages/core/src/shared/components/PlaceOrderPanel.jsx';
const CREATE_ORDER_FORM = 'packages/core/src/shared/routes/CreateOrderForm.jsx';
const CROSS_CHAIN_ORDER_FORM = 'packages/core/src/shared/routes/CrossChainOrderForm.jsx';
const CROSS_CHAIN_SWAP_FORM = 'packages/core/src/shared/routes/CrossChainSwapForm.jsx';
const SHELL_WIRING = [
    'packages/web/src/surfaces/dex.jsx',
    'packages/extension/src/popup/App.jsx',
    'packages/desktop/renderer/App.jsx',
];

// Comments describe the boundary in prose; the scan must only see code.
function codeOf(rel) {
    return readFileSync(SRC(rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

beforeEach(() => {
    vi.mocked(submitAction).mockClear();
    vi.mocked(submitAction).mockResolvedValue({ txid: 'order-tx-1' });
});

describe('orderAction chain scope', () => {
    it('signs on the single opts.chainId and never derives a second chain from params', async () => {
        await orderAction({
            vault: {}, walletId: 'w1', password: 'pw', chainRegistry: {}, sdkRegistry: {},
            chainId: 'bitcoin-regtest', from: FROM,
            params: {
                VERSION: '0',
                GIVE_COIN: 'BTC', GIVE_TICK: 'JDOG', GIVE_AMOUNT: '10',
                GET_COIN: 'LTC', GET_TICK: '', GET_AMOUNT: '1',
            },
        });
        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.chainId).toBe('bitcoin-regtest');
        expect(Object.keys(call)).not.toContain('giveChainId');
        expect(Object.keys(call)).not.toContain('getChainId');
    });

    it('forwards a cross-chain param map verbatim: the flow is not what decides it', async () => {
        const params = {
            VERSION: '0',
            GIVE_COIN: 'BTC', GIVE_TICK: 'JDOG', GIVE_AMOUNT: '10',
            GET_COIN: 'DOGE', GET_TICK: '', GET_AMOUNT: '5000',
        };
        await orderAction({
            vault: {}, walletId: 'w1', password: 'pw', chainRegistry: {}, sdkRegistry: {},
            chainId: 'bitcoin-regtest', from: FROM, params,
        });
        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.actionData.action).toBe('ORDER');
        // Neither rejected nor rewritten: the coins survive untouched, the
        // same way swapAction carries a cross-chain SWAP.
        expect(call.actionData.params).toEqual(params);
        expect(call.actionData.params.GIVE_COIN).not.toBe(call.actionData.params.GET_COIN);
    });
});

describe('the same-chain ORDER surfaces stay single-chain', () => {
    it('PlaceOrderPanel emits one coin on both sides of the pair', () => {
        const code = codeOf(PLACE_ORDER_PANEL);
        expect(code).toContain("GIVE_COIN: coinTicker, GET_COIN: coinTicker");
        expect(code).not.toMatch(/giveChainId|getChainId/);
    });

    it('CreateOrderForm emits one coin on both sides of the pair', () => {
        const code = codeOf(CREATE_ORDER_FORM);
        expect(code).toContain("GIVE_COIN: coinTicker, GET_COIN: coinTicker");
        expect(code).not.toMatch(/giveChainId|getChainId/);
    });

    it('CreateOrderForm tells the user where the cross-chain case lives', () => {
        // In rendered copy, not a comment: the boundary is stated to the
        // user, not only to the next maintainer.
        expect(codeOf(CREATE_ORDER_FORM)).toMatch(/use Cross-chain order/);
    });
});

describe('CrossChainOrderForm is the cross-chain ORDER surface', () => {
    it('exists and splits the give and get chains', () => {
        const code = codeOf(CROSS_CHAIN_ORDER_FORM);
        expect(code).toMatch(/giveChainId/);
        expect(code).toMatch(/getChainId/);
        // Two coins on the wire, never the panel-style single ticker.
        expect(code).toContain('GIVE_COIN: giveCoinTicker');
        expect(code).toContain('p.GET_COIN = getCoinTicker');
        expect(code).not.toContain('GIVE_COIN: coinTicker, GET_COIN: coinTicker');
    });

    it('resolves GET_ADDRESS on the get chain and signs through orderAction', () => {
        const code = codeOf(CROSS_CHAIN_ORDER_FORM);
        expect(code).toMatch(/useGetChainAddress\(\{[^}]*getChainId/);
        expect(code).toContain('p.GET_ADDRESS = getAddress.trim()');
        expect(code).toMatch(/submitMethods:\s*\{\s*hw:\s*'orderActionHw',\s*software:\s*'orderAction'\s*\}/);
        expect(code).not.toContain('swapAction');
    });

    it('is the only ORDER v0 composer besides the two same-chain surfaces', () => {
        // A new ORDER v0 composer sets VERSION '0' next to GIVE_COIN. If one
        // appears elsewhere, this list is stale.
        for (const rel of [PLACE_ORDER_PANEL, CREATE_ORDER_FORM, CROSS_CHAIN_ORDER_FORM]) {
            expect(codeOf(rel)).toMatch(/VERSION:\s*'0',\s*GIVE_COIN/);
        }
    });

    it('is routed by every shell beside Cross-chain swap', () => {
        for (const rel of SHELL_WIRING) {
            const code = codeOf(rel);
            expect(code, rel).toContain("unlockedView === 'cross-chain-swap'");
            expect(code, rel).toContain("unlockedView === 'cross-chain-order'");
            expect(code, rel).toMatch(/<CrossChainOrderForm\b[\s\S]*?walletId=\{activeWalletId\}/);
        }
    });

    it('is reachable from the palette and the actions menu, gated with the DEX surface', () => {
        const ids = (ctx) => buildCommands({ navigate() {}, ...ctx }).map((c) => c.id);
        expect(ids({})).toContain('trade-xchain-order');
        expect(ids({})).toContain('trade-xchain-swap');
        expect(ids({ hasDexSurface: false })).not.toContain('trade-xchain-order');
        const targets = [];
        buildCommands({ navigate: (v) => targets.push(v) }).find((c) => c.id === 'trade-xchain-order').run();
        expect(targets).toEqual(['cross-chain-order']);
        const entry = ACTION_ENTRY_DEFS.find((e) => e.id === 'cross-chain-order');
        expect(entry?.handler).toBe('onCrossChainOrder');
        expect(entry?.label).toBe('Cross-chain order');
    });

    it('CrossChainSwapForm is unchanged in shape: SWAP still splits give/get chains', () => {
        const code = codeOf(CROSS_CHAIN_SWAP_FORM);
        expect(code).toMatch(/giveChainId/);
        expect(code).toMatch(/getChainId/);
        expect(code).toContain('GIVE_COIN: giveCoinTicker');
    });
});
