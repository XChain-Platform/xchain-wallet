// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wallet's ORDER authoring boundary is single-chain.
//
// The wire permits GIVE_COIN != GET_COIN (a cross-chain order escrows the
// GIVE side locally and is matched + settled by the validator federation
// through CROSS_SETTLE, ORDER.md "Notes"), and the flow layer already
// carries such a param map untouched. The gap is purely the authoring UI:
// both ORDER surfaces hardcode one coin on both sides, so cross-chain
// trading from the wallet is SWAP-only.
//
// These are BOUNDARY tests, not defect guards. They pin the documented
// state so the moment a cross-chain ORDER surface is built the suite goes
// red and gets revisited rather than silently rotting.

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
const CROSS_CHAIN_SWAP_FORM = 'packages/core/src/shared/routes/CrossChainSwapForm.jsx';

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

    it('forwards a cross-chain param map verbatim: the flow is not what blocks it', async () => {
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

describe('ORDER authoring surfaces are single-chain', () => {
    it('PlaceOrderPanel emits one coin on both sides of the pair', () => {
        const code = codeOf(PLACE_ORDER_PANEL);
        expect(code).toContain("GIVE_COIN: coinTicker, GET_COIN: coinTicker");
        expect(code).not.toMatch(/giveChainId|getChainId/);
    });

    it('CreateOrderForm (PC-17) emits one coin on both sides of the pair', () => {
        const code = codeOf(CREATE_ORDER_FORM);
        expect(code).toContain("GIVE_COIN: coinTicker, GET_COIN: coinTicker");
        expect(code).not.toMatch(/giveChainId|getChainId/);
    });

    it('these two are the ONLY ORDER-composing surfaces the scan needs to cover', () => {
        // A new ORDER v0 composer would set VERSION '0' next to GIVE_COIN.
        // If one appears elsewhere, this list (and the boundary doc) is stale.
        for (const rel of [PLACE_ORDER_PANEL, CREATE_ORDER_FORM]) {
            expect(codeOf(rel)).toMatch(/VERSION:\s*'0',\s*GIVE_COIN/);
        }
    });

    it('CrossChainSwapForm proves the contrast: SWAP does split give/get chains', () => {
        const code = codeOf(CROSS_CHAIN_SWAP_FORM);
        expect(code).toMatch(/giveChainId/);
        expect(code).toMatch(/getChainId/);
        // Cross-chain exposure from the wallet is SWAP-only, not ORDER.
        expect(code).toContain('GIVE_COIN: giveCoinTicker');
    });
});
