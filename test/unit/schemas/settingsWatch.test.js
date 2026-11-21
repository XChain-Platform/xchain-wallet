// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import {
    CURRENT_VERSION,
    WATCH_DEFAULTS,
    createDefaultSettings,
    inflateSettings,
    resolveWatchSettings,
    validateSettings,
} from '../../../packages/core/src/schemas/settings.js';

describe('watch settings', () => {
    it('uses the design defaults', () => {
        expect(createDefaultSettings().watch).toEqual({
            enabled: true,
            tokenMode: 'home',
            startIn: 'fiat',
            showTotal: false,
            backgroundActivityCheck: true,
        });
        expect(inflateSettings({ schemaVersion: CURRENT_VERSION }).watch).toEqual(WATCH_DEFAULTS);
    });

    it('accepts absent legacy settings and valid overrides', () => {
        const legacy = createDefaultSettings();
        delete legacy.watch;
        expect(validateSettings(legacy).ok).toBe(true);

        const settings = createDefaultSettings();
        settings.watch = {
            enabled: false,
            tokenMode: 'pinned',
            startIn: 'units',
            showTotal: true,
            backgroundActivityCheck: false,
        };
        expect(validateSettings(settings).ok).toBe(true);
    });

    it('rejects malformed watch settings', () => {
        const settings = createDefaultSettings();
        settings.watch.tokenMode = 'all';
        expect(validateSettings(settings).ok).toBe(false);
    });

    it('forces the effective background check off under Tor routing', () => {
        const settings = createDefaultSettings();
        expect(resolveWatchSettings(settings).backgroundActivityCheck).toBe(true);
        settings.privacy.torRouting = true;
        expect(resolveWatchSettings(settings).backgroundActivityCheck).toBe(false);
        expect(settings.watch.backgroundActivityCheck).toBe(true);
        delete settings.watch;
        expect(resolveWatchSettings(settings).backgroundActivityCheck).toBe(false);
    });
});
