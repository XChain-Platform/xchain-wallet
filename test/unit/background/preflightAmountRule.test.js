// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The host's action.preflight route settles AMOUNT_REPRESENTABILITY with the
// SDK validators its shell hands it, on the first report and the Approve-time
// re-check alike. Without the validators the report passes through unchanged.

import { describe, expect, it } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { amountRulesFromSdk } from '../../../packages/core/src/flows/amountRepresentability.js';
import { requireSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';
import { chainRegistry, memCollection } from './_addressesByChainFixture.js';

const installed = sdkInstalled();
const XCP = { tick: 'XCP', info: { tick: 'XCP', decimals: 8 }, supply: { max: '1000000', current: '400', decimals: 8 }, max_mint: '10' };

describe.skipIf(!installed)('action.preflight settles the amount rule', () => {
    const engine = requireSdkDeep('preflightEngine');
    const decoder = requireSdkDeep('decoder');
    const loadAmountRules = async () => amountRulesFromSdk({
        numeric: requireSdkDeep('preflightNumeric'),
        amountFormat: requireSdkDeep('preflightAmountFormat'),
    });

    // A mainnet SDK whose explorer approves every action and knows one token.
    function mainnetSdk() {
        const sdk = {
            config: { network: 'mainnet' },
            _preflightCoalescer: { run: (_key, producer) => producer() },
            decoder,
            explorer: {
                coin: 'BTC',
                getToken: async (tick) => (tick === 'XCP' ? XCP : null),
                getPreflight: async () => ({ supported: true, valid: true, status: 'valid' }),
            },
            preflight: (actionString, opts) => engine.runPreflight(sdk, actionString, opts),
        };
        return sdk;
    }

    function hostWith(deps = {}) {
        return createBackgroundHost({
            vault: {
                wallets: memCollection(), accounts: memCollection(), addresses: memCollection(), signers: memCollection(),
                settings: { async get() { return { schemaVersion: 1, activeNetwork: 'mainnet', fees: {}, ads: { perChain: {} } }; }, async put() {} },
            },
            chainRegistry,
            sdkRegistry: { get: () => mainnetSdk() },
            signerPool: { get: () => null, has: () => false },
            broadcastQueueStorage: null,
            signThrottleStorage: null,
            logConsoleStorage: null,
            ...deps,
        });
    }

    const checksOf = async (host, actionString, bypassCache = false) => {
        const res = await host.handle({
            type: 'action.preflight',
            request: { chainId: 'bitcoin-mainnet', actionString, source: 'bc1qfixture', bypassCache },
        });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        return res.result.unverified.map((u) => u.check);
    };

    it('drops the item for a mint whose amount passes, on the first report and the re-check', async () => {
        const host = hostWith({ loadAmountRules });
        expect(await checksOf(host, 'MINT|0|XCP|1')).toEqual(['MINT_ADDRESS_HEADROOM']);
        expect(await checksOf(host, 'MINT|0|XCP|1', true)).toEqual(['MINT_ADDRESS_HEADROOM']);
    });

    it('keeps the item for an amount the newer rule refuses', async () => {
        const host = hostWith({ loadAmountRules });
        expect(await checksOf(host, 'SEND|0|XCP|1e2|bc1qdest')).toContain('AMOUNT_REPRESENTABILITY');
    });

    it('passes the report through when the shell hands no validators or they fail to load', async () => {
        expect(await checksOf(hostWith(), 'MINT|0|XCP|1')).toEqual(['AMOUNT_REPRESENTABILITY', 'MINT_ADDRESS_HEADROOM']);
        const failing = hostWith({ loadAmountRules: async () => { throw new Error('not loadable here'); } });
        expect(await checksOf(failing, 'MINT|0|XCP|1')).toEqual(['AMOUNT_REPRESENTABILITY', 'MINT_ADDRESS_HEADROOM']);
    });
});
