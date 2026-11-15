// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The stored custom-chain list has one set of writers, the add and remove
// routes, because they validate every descriptor and keep the registry in
// step. A settings patch must not reach it.

import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { updateSettings } from '../../../packages/core/src/flows/settings.js';

function memoryVault() {
    let record = createDefaultSettings();
    let puts = 0;
    return {
        settings: {
            async get() { return structuredClone(record); },
            async put(next) { puts += 1; record = structuredClone(next); },
        },
        read: () => record,
        puts: () => puts,
    };
}

describe('updateSettings and the custom-chain list', () => {
    it('refuses a patch that sets customChains and writes nothing', async () => {
        const vault = memoryVault();
        await expect(updateSettings(vault, { customChains: [{ id: 'anything' }] }))
            .rejects.toThrow(/addCustomChain and removeCustomChain/);
        await expect(updateSettings(vault, { customChains: [] })).rejects.toThrow(/customChains/);
        expect(vault.puts()).toBe(0);
        expect(vault.read().customChains).toBeUndefined();
    });

    it('still applies the other keys of a patch that leaves customChains unset', async () => {
        const vault = memoryVault();
        await updateSettings(vault, { learnMode: true, customChains: undefined });
        expect(vault.read().learnMode).toBe(true);
        expect(vault.puts()).toBe(1);
    });
});
