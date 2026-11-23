// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { configureFiatRateSource } from '../../core/src/flows/priceLookup.js';

export function installSampleFiatSource(rates) {
    configureFiatRateSource({
        fetch: async (url) => {
            if (String(url).includes('simple/price')) {
                return {
                    ok: true,
                    json: async () => ({
                        bitcoin: { usd: rates.bitcoin },
                        litecoin: { usd: rates.litecoin },
                        dogecoin: { usd: rates.dogecoin },
                    }),
                };
            }
            return { ok: false, status: 404, json: async () => ({}) };
        },
    });
}
