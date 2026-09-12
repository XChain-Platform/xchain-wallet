// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The pure half of the wallet's bridge surfaces: origin-rooted names, which
// XBRIDGE leg a move is, and the below-fee comparison. Every case here is a
// user-visible decision the move form and the origin badge both read.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    parseBridgedTick,
    bridgeDisplayTick,
    bridgeLegFor,
    bridgeChainsList,
    bridgeDestinationError,
    compareDecimal,
    belowFeeWarning,
    quotedProtocolFee,
    xbridgeActionString,
    xbridgeWireFields,
    coinDisplay,
} from '../../../packages/core/src/shared/routes/BridgeTick.js';

describe('parseBridgedTick', () => {
    it('splits an origin-rooted copy into origin and bare name', () => {
        expect(parseBridgedTick('BTC.PEPECASH', 'DOGE')).toEqual({ origin: 'BTC', name: 'PEPECASH' });
        expect(parseBridgedTick('DOGE.FUFU', 'BTC')).toEqual({ origin: 'DOGE', name: 'FUFU' });
    });

    it('is not bridged when the root is THIS chain\'s own coin (an ordinary subasset)', () => {
        expect(parseBridgedTick('BTC.PEPECASH', 'BTC')).toBeNull();
        expect(parseBridgedTick('DOGE.FUFU', 'dogecoin')).toBeNull();
    });

    it('is not bridged without exactly one dot', () => {
        expect(parseBridgedTick('PEPECASH', 'DOGE')).toBeNull();
        expect(parseBridgedTick('BTC.PEPE.CASH', 'DOGE')).toBeNull();
        expect(parseBridgedTick('BTC.', 'DOGE')).toBeNull();
    });

    it('is not bridged when the root is not a protocol coin', () => {
        expect(parseBridgedTick('ETH.USDT', 'DOGE')).toBeNull();
        expect(parseBridgedTick('MYTOKEN.SUB', 'DOGE')).toBeNull();
    });

    it('renders the bare name with the origin carried separately', () => {
        expect(bridgeDisplayTick('BTC.PEPECASH', 'DOGE')).toEqual({ label: 'PEPECASH', origin: 'BTC' });
        expect(bridgeDisplayTick('PEPECASH', 'BTC')).toEqual({ label: 'PEPECASH', origin: null });
    });
});

describe('bridgeLegFor', () => {
    it('locks XCHAIN on Bitcoin (v0) and lets the user choose the destination', () => {
        expect(bridgeLegFor({ tick: 'XCHAIN', sourceCoin: 'BTC' }))
            .toEqual({ version: '0', leg: 'lock', fixedDestination: null, origin: 'BTC' });
    });

    it('burns XCHAIN off Bitcoin (v1) back to Bitcoin only', () => {
        expect(bridgeLegFor({ tick: 'XCHAIN', sourceCoin: 'DOGE' }))
            .toEqual({ version: '1', leg: 'burn', fixedDestination: 'BTC', origin: 'BTC' });
    });

    it('locks a native token (v3) and burns a bridged copy (v4) back to its origin', () => {
        expect(bridgeLegFor({ tick: 'FUFU', sourceCoin: 'DOGE' }))
            .toEqual({ version: '3', leg: 'lock', fixedDestination: null, origin: 'DOGE' });
        expect(bridgeLegFor({ tick: 'DOGE.FUFU', sourceCoin: 'BTC' }))
            .toEqual({ version: '4', leg: 'burn', fixedDestination: 'DOGE', origin: 'DOGE' });
    });

    it('refuses a subasset with a reason, rather than composing a doomed lock', () => {
        const leg = bridgeLegFor({ tick: 'PEPE.CASH', sourceCoin: 'BTC' });
        expect(leg.version).toBeNull();
        expect(leg.reason).toContain('Subassets cannot be bridged yet');
    });
});

describe('bridgeChainsList', () => {
    it('reads a comma list, the "-" sentinel and the empty (unchanged) field apart', () => {
        expect(bridgeChainsList('DOGE,LTC')).toEqual(['DOGE', 'LTC']);
        expect(bridgeChainsList(' doge , ltc ')).toEqual(['DOGE', 'LTC']);
        expect(bridgeChainsList('-')).toEqual([]);
        expect(bridgeChainsList('')).toBeNull();
        expect(bridgeChainsList(undefined)).toBeNull();
    });
});

describe('bridgeDestinationError', () => {
    it('refuses a burn aimed anywhere but the origin, and names where it does go', () => {
        const msg = bridgeDestinationError({ tick: 'BTC.PEPECASH', sourceCoin: 'DOGE', destCoin: 'LTC' });
        expect(msg).toContain('bridged copy of a Bitcoin asset');
        expect(msg).toContain('Litecoin is not a destination for it');
        expect(bridgeDestinationError({ tick: 'BTC.PEPECASH', sourceCoin: 'DOGE', destCoin: 'BTC' })).toBeNull();
    });

    it('refuses a destination the issuer never opted in to, and lists the ones they did', () => {
        const msg = bridgeDestinationError({
            tick: 'FUFU', sourceCoin: 'DOGE', destCoin: 'BTC', bridgeChains: ['LTC'],
        });
        expect(msg).toContain('has not opened it to Bitcoin');
        expect(msg).toContain('Litecoin');
    });

    it('refuses a token whose issuer opted out entirely', () => {
        expect(bridgeDestinationError({
            tick: 'FUFU', sourceCoin: 'DOGE', destCoin: 'BTC', bridgeChains: [],
        })).toContain('has not opened it to the bridge');
    });

    it('makes NO claim when the opt-in list is unknown', () => {
        expect(bridgeDestinationError({
            tick: 'FUFU', sourceCoin: 'DOGE', destCoin: 'BTC', bridgeChains: null,
        })).toBeNull();
    });

    it('refuses a move to the chain the asset is already on', () => {
        expect(bridgeDestinationError({ tick: 'XCHAIN', sourceCoin: 'BTC', destCoin: 'BTC' }))
            .toContain('already on Bitcoin');
    });
});

describe('compareDecimal', () => {
    it('orders by value, not by string length or float', () => {
        expect(compareDecimal('10', '9')).toBe(1);
        expect(compareDecimal('0.1', '0.09')).toBe(1);
        expect(compareDecimal('0.05', '0.05000000')).toBe(0);
        expect(compareDecimal('0.049', '0.05')).toBe(-1);
        // 0.1 + 0.2 in binary floats is 0.30000000000000004; as strings it is not.
        expect(compareDecimal('0.30000000', '0.3')).toBe(0);
    });

    it('answers null (no claim) on anything that is not a plain decimal', () => {
        expect(compareDecimal('', '1')).toBeNull();
        expect(compareDecimal('-1', '1')).toBeNull();
        expect(compareDecimal('1e3', '1')).toBeNull();
        expect(compareDecimal('abc', '1')).toBeNull();
    });
});

describe('belowFeeWarning', () => {
    it('warns when the move is smaller than the fee it pays', () => {
        const msg = belowFeeWarning({ amount: '0.01', fee: '0.05', tick: 'XCHAIN' });
        expect(msg).toContain('Moving 0.01 XCHAIN costs 0.05 XCHAIN in protocol fees');
        expect(msg).toContain('more than the amount you are moving');
    });

    it('warns when the move exactly equals the fee, in the right words', () => {
        expect(belowFeeWarning({ amount: '0.05', fee: '0.05', tick: 'XCHAIN' }))
            .toContain('the same as the amount you are moving');
    });

    it('stays silent above the fee', () => {
        expect(belowFeeWarning({ amount: '0.06', fee: '0.05', tick: 'XCHAIN' })).toBeNull();
        expect(belowFeeWarning({ amount: '5', fee: '0.05', tick: 'XCHAIN' })).toBeNull();
    });

    it('stays silent with no quoted fee rather than guessing one', () => {
        expect(belowFeeWarning({ amount: '0.01', fee: null, tick: 'XCHAIN' })).toBeNull();
        expect(belowFeeWarning({ amount: '0.01', fee: undefined, tick: 'XCHAIN' })).toBeNull();
    });
});

describe('quotedProtocolFee', () => {
    it('reads a positive fee and trims its trailing zeros', () => {
        expect(quotedProtocolFee({ xchainFee: '0.05000000' })).toBe('0.05');
        expect(quotedProtocolFee({ xchainFee: 0.05 })).toBe('0.05');
    });

    it('takes the fee from a quote the dry run refused, because XBRIDGE_BASE is flat', () => {
        // The commonest refusal on this very screen is "insufficient funds",
        // which is exactly when the user most needs to see the fee.
        expect(quotedProtocolFee({ valid: false, xchainFee: '0.05000000' })).toBe('0.05');
    });

    it('answers null for an unpriced, unsupported or zero quote', () => {
        expect(quotedProtocolFee(null)).toBeNull();
        expect(quotedProtocolFee({ supported: false, xchainFee: '0.05' })).toBeNull();
        expect(quotedProtocolFee({ xchainFee: '0.00000000' })).toBeNull();
        expect(quotedProtocolFee({})).toBeNull();
    });
});

describe('xbridgeActionString', () => {
    it('serializes each user-broadcast version, trailing empties trimmed', () => {
        expect(xbridgeActionString({
            VERSION: '0', DEST_COIN: 'DOGE', DEST_ADDRESS: 'DAddr', AMOUNT: '5', MEMO: '',
        })).toBe('XBRIDGE|0|DOGE|DAddr|5');
        expect(xbridgeActionString({
            VERSION: '1', BTC_ADDRESS: 'bc1q', AMOUNT: '2', MEMO: 'back',
        })).toBe('XBRIDGE|1|bc1q|2|back');
        expect(xbridgeActionString({
            VERSION: '3', TICK: 'FUFU', DEST_COIN: 'DOGE', DEST_ADDRESS: 'DAddr', AMOUNT: '5',
        })).toBe('XBRIDGE|3|FUFU|DOGE|DAddr|5');
        expect(xbridgeActionString({
            VERSION: '4', TICK: 'BTC.FUFU', ORIGIN_ADDRESS: 'bc1q', AMOUNT: '2',
        })).toBe('XBRIDGE|4|BTC.FUFU|bc1q|2');
    });

    it('refuses a version with no user-broadcast format (the injected settle legs)', () => {
        expect(xbridgeActionString({ VERSION: '2', AMOUNT: '1' })).toBeNull();
        expect(xbridgeActionString({ VERSION: '5', AMOUNT: '1' })).toBeNull();
    });

    // IDENTITY against the SDK's own format table. The popup cannot import the
    // SDK, so this copy is pinned to the source rather than trusted. Skipped
    // when the sibling checkout is absent, the ActionManifestConformance
    // convention.
    it('field order matches xchain-sdk formats.js exactly', (ctx) => {
        const formats = process.env.XCHAIN_SDK_DIR
            ? join(process.env.XCHAIN_SDK_DIR, 'src', 'formats.js')
            : join(process.cwd(), '..', 'xchain-sdk', 'src', 'formats.js');
        if (!existsSync(formats)) {
            if (process.env.XCHAIN_REQUIRE_SIBLINGS === '1') {
                throw new Error(`XCHAIN_REQUIRE_SIBLINGS=1 but xchain-sdk formats.js not found at ${formats}`);
            }
            ctx.skip();
            return;
        }
        const src = readFileSync(formats, 'utf8');
        const block = src.match(/XBRIDGE:\s*\{([\s\S]*?)\}/);
        expect(block, 'xchain-sdk formats.js has no XBRIDGE block').toBeTruthy();
        /** @type {Record<string, string[]>} */
        const fromSdk = {};
        for (const line of block[1].split('\n')) {
            const m = line.match(/^\s*(\d+):\s*'([^']+)'/);
            if (!m) continue;
            // Drop the leading VERSION token: the serializer emits it from the
            // version itself, so the field list starts after it.
            fromSdk[m[1]] = m[2].split('|').slice(1);
        }
        expect(Object.keys(fromSdk).sort()).toEqual(['0', '1', '3', '4']);
        for (const [version, fields] of Object.entries(fromSdk)) {
            expect(xbridgeWireFields(version), `XBRIDGE v${version} field order`).toEqual(fields);
        }
    });
});

describe('coinDisplay', () => {
    it('names chains the way the rest of the wallet does', () => {
        expect(coinDisplay('BTC')).toBe('Bitcoin');
        expect(coinDisplay('dogecoin')).toBe('Dogecoin');
        expect(coinDisplay('LTC')).toBe('Litecoin');
    });
});
