// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { updateSettings } from '../../../packages/core/src/flows/settings.js';
import {
    createDefaultSettings,
    resolveWatchSettings,
} from '../../../packages/core/src/schemas/settings.js';
import { watchControls } from '../../../packages/core/src/shared/components/settings/watchSectionControls.js';

function memoryVault(settings) {
    let stored = structuredClone(settings);
    return {
        settings: {
            get: async () => structuredClone(stored),
            put: async (next) => { stored = structuredClone(next); },
        },
        stored: () => structuredClone(stored),
    };
}

describe('watch section controls', () => {
    it('describes the four inline controls without display copy', () => {
        expect(Object.keys(watchControls)).toEqual([
            'enabled',
            'showTotal',
            'tokenMode',
            'startIn',
        ]);
        expect(watchControls.enabled.kind).toBe('switch');
        expect(watchControls.showTotal.kind).toBe('switch');
        expect(watchControls.tokenMode.kind).toBe('select');
        expect(watchControls.startIn.kind).toBe('select');
        expect(watchControls.tokenMode.options()).toEqual([
            { value: 'home' },
            { value: 'pinned' },
        ]);
        expect(watchControls.startIn.options()).toEqual([
            { value: 'fiat' },
            { value: 'units' },
        ]);
    });

    it('reads resolved settings', () => {
        expect(watchControls.enabled.checked({})).toBe(true);
        expect(watchControls.showTotal.checked({})).toBe(false);
        expect(watchControls.tokenMode.value({})).toBe('home');
        expect(watchControls.startIn.value({})).toBe('fiat');

        const settings = {
            watch: {
                enabled: false,
                showTotal: true,
                tokenMode: 'pinned',
                startIn: 'units',
            },
        };
        expect(watchControls.enabled.checked(settings)).toBe(false);
        expect(watchControls.showTotal.checked(settings)).toBe(true);
        expect(watchControls.tokenMode.value(settings)).toBe('pinned');
        expect(watchControls.startIn.value(settings)).toBe('units');
    });

    it.each([
        ['enabled', false],
        ['showTotal', true],
        ['tokenMode', 'pinned'],
        ['startIn', 'units'],
    ])('patches only watch.%s through updateSettings', async (field, value) => {
        const initial = createDefaultSettings();
        initial.privacy.torRouting = true;
        initial.watch.backgroundActivityCheck = true;
        expect(resolveWatchSettings(initial).backgroundActivityCheck).toBe(false);
        const vault = memoryVault(initial);
        const patch = watchControls[field].patch(value);

        expect(patch).toEqual({ watch: { [field]: value } });
        await updateSettings(vault, patch);

        expect(vault.stored().watch).toEqual({
            ...initial.watch,
            [field]: value,
        });
        expect(vault.stored().watch.backgroundActivityCheck).toBe(true);
    });

    it.each([
        ['enabled', 'true'],
        ['showTotal', 1],
        ['tokenMode', 'all'],
        ['startIn', 'tokens'],
    ])('refuses an invalid %s value', (field, value) => {
        expect(() => watchControls[field].patch(value)).toThrow(TypeError);
    });
});
