// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Patches sent while another is still being written all land: each one
// reads the record the previous one wrote.

import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { updateSettings } from '../../../packages/core/src/flows/settings.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function slowVault() {
    let record = createDefaultSettings();
    return {
        settings: {
            async get() { await tick(); return structuredClone(record); },
            async put(next) { await tick(); record = structuredClone(next); },
        },
        read: () => record,
    };
}

describe('updateSettings with patches in flight together', () => {
    it('keeps every patch', async () => {
        const vault = slowVault();
        await Promise.all([
            updateSettings(vault, { privacy: { hapticsEnabled: false } }),
            updateSettings(vault, { privacy: { priceDataEnabled: false } }),
            updateSettings(vault, { fiatCurrency: 'EUR' }),
            updateSettings(vault, { learnMode: true }),
        ]);
        const saved = vault.read();
        expect(saved.privacy.hapticsEnabled).toBe(false);
        expect(saved.privacy.priceDataEnabled).toBe(false);
        expect(saved.fiatCurrency).toBe('EUR');
        expect(saved.learnMode).toBe(true);
    });

    it('lets the next patch run after one is rejected', async () => {
        const vault = slowVault();
        const bad = updateSettings(vault, { theme: 'not-a-theme' });
        const good = updateSettings(vault, { learnMode: true });
        await expect(bad).rejects.toThrow(/invalid settings/);
        await good;
        expect(vault.read().learnMode).toBe(true);
    });
});

describe('other settings writers share the same queue', () => {
    it('a block and a patch in flight together both land', async () => {
        const { addBlockedOrigin } = await import('../../../packages/core/src/flows/blocklist.js');
        const vault = slowVault();
        vault.connectedSites = { list: async () => [], findBy: async () => [], delete: async () => {} };
        await Promise.all([
            addBlockedOrigin({ vault, origin: 'https://evil.example' }),
            updateSettings(vault, { learnMode: true }),
        ]);
        const saved = vault.read();
        expect(saved.blockedOrigins).toContain('https://evil.example');
        expect(saved.learnMode).toBe(true);
    });
});
