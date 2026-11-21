// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { buildWatchSettings } from '../../../packages/core/src/watch/buildWatchSettings.js';

describe('buildWatchSettings', () => {
    it('builds the snapshot settings block from watch preferences', () => {
        const settings = createDefaultSettings();
        settings.watch.enabled = false;
        settings.watch.showTotal = true;

        expect(buildWatchSettings(settings)).toEqual({
            showTotal: true,
            enabled: false,
        });
    });

    it('uses watch defaults for a legacy settings record', () => {
        expect(buildWatchSettings({})).toEqual({
            showTotal: false,
            enabled: true,
        });
    });

    it('excludes watch preferences outside the snapshot contract', () => {
        const settings = createDefaultSettings();
        settings.watch.tokenMode = 'pinned';
        settings.watch.startIn = 'units';
        settings.watch.backgroundActivityCheck = false;

        expect(buildWatchSettings(settings)).toEqual({
            showTotal: false,
            enabled: true,
        });
    });
});
