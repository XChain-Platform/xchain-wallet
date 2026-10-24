// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A custom network's refusals read as plain sentences.

import { describe, it, expect } from 'vitest';
import { ChainRegistry, BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';
import { addCustomChain } from '../../../packages/core/src/flows/customChains.js';

const base = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-mainnet');
const descriptor = (extra = {}) => ({ ...base, ...extra });

function makeVault() {
    let settings = {};
    return { settings: { get: async () => settings, put: async (next) => { settings = next; } } };
}

const add = (d) => addCustomChain({ vault: makeVault(), chainRegistry: new ChainRegistry(), descriptor: d });

describe('custom network refusals', () => {
    it('names no function and no "invalid descriptor" prefix', async () => {
        const bad = descriptor({ id: 'forkcoin-regtest', coin: 'forkcoin', networkKind: 'regtest', explorer: 'http://x' });
        const err = await add({ ...bad, id: '' }).catch((e) => e);
        expect(err.message).toMatch(/^This network can't be added\./);
        expect(err.message).not.toMatch(/addCustomChain|invalid descriptor/i);
    });
});
