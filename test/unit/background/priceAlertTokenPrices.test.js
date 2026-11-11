// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// background.js registers chrome.* listeners at module load and cannot be
// imported here, so the price-alert watcher construction is pinned by
// evaluating its source block against stubs.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const bgPath = join(here, '..', '..', '..', 'packages', 'extension', 'src', 'background.js');

function extractBlock() {
    const bg = readFileSync(bgPath, 'utf8');
    const start = bg.indexOf('if (!priceAlertWatcher &&');
    const end = bg.indexOf('priceAlertWatcher.start();', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return bg.slice(start, end + 'priceAlertWatcher.start();'.length) + '\n}';
}

function run({ withExport, settings }) {
    const captured = {};
    class Watcher {
        constructor(deps) { captured.deps = deps; }
        start() { captured.started = true; }
    }
    const lookup = vi.fn(async () => ({ prices: {} }));
    const createTokenPriceLookup = vi.fn(() => lookup);
    const notificationsLib = { PriceAlertWatcher: Watcher };
    if (withExport) notificationsLib.createTokenPriceLookup = createTokenPriceLookup;
    const flowsLib = {
        createPriceOracle: () => ({ getNativePrices: async () => ({}) }),
        getSettings: async () => settings,
        markAlertTriggered: async () => {},
    };
    const body = `let priceAlertWatcher = null;\n${extractBlock()}\nreturn priceAlertWatcher;`;
    const fn = new Function(
        'globalThis', 'flowsLib', 'notificationsLib', 'vault', 'chainRegistry',
        'chromeNotify', 'priceAlertFiredStore', body,
    );
    const registry = { id: 'registry' };
    fn(
        { fetch: () => {} }, flowsLib, notificationsLib, { priceAlerts: { list: () => [] } },
        registry, () => {}, { load: async () => [], save: async () => {} },
    );
    return { captured, createTokenPriceLookup, lookup, registry };
}

describe('extension price-alert watcher token prices', () => {
    it('passes getTokenPrices backed by the shared lookup when core exports it', async () => {
        const { captured, createTokenPriceLookup, lookup, registry } = run({
            withExport: true,
            settings: { privacy: { priceDataEnabled: false } },
        });
        expect(captured.started).toBe(true);
        expect(typeof captured.deps.getTokenPrices).toBe('function');
        const req = { items: [{ chainId: 'c', tick: 'T' }], fiatCurrency: 'USD' };
        await captured.deps.getTokenPrices(req);
        expect(lookup).toHaveBeenCalledWith(req);
        const args = createTokenPriceLookup.mock.calls[0][0];
        expect(args.chainRegistry).toBe(registry);
        expect(args.allowCoingeckoFallback()).toBe(false);
    });

    it('allows the fallback unless the privacy setting turns it off', async () => {
        const { captured, createTokenPriceLookup } = run({ withExport: true, settings: {} });
        await captured.deps.getTokenPrices({ items: [], fiatCurrency: 'USD' });
        expect(createTokenPriceLookup.mock.calls[0][0].allowCoingeckoFallback()).toBe(true);
    });

    it('still starts the watcher without the export', () => {
        const { captured } = run({ withExport: false, settings: {} });
        expect(captured.started).toBe(true);
        expect('getTokenPrices' in captured.deps).toBe(false);
    });
});
