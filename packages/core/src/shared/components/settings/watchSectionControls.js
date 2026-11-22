// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    WATCH_START_MODES,
    WATCH_TOKEN_MODES,
    resolveWatchSettings,
} from '../../../schemas/settings.js';

export const watchControls = {
    enabled: {
        kind: 'switch',
        checked: (settings) => resolveWatchSettings(settings).enabled,
        patch(next) {
            if (typeof next !== 'boolean') throw new TypeError();
            return { watch: { enabled: next } };
        },
    },
    showTotal: {
        kind: 'switch',
        checked: (settings) => resolveWatchSettings(settings).showTotal,
        patch(next) {
            if (typeof next !== 'boolean') throw new TypeError();
            return { watch: { showTotal: next } };
        },
    },
    tokenMode: {
        kind: 'select',
        value: (settings) => resolveWatchSettings(settings).tokenMode,
        options: () => WATCH_TOKEN_MODES.map((value) => ({ value })),
        patch(value) {
            if (!WATCH_TOKEN_MODES.includes(value)) throw new TypeError();
            return { watch: { tokenMode: value } };
        },
    },
    startIn: {
        kind: 'select',
        value: (settings) => resolveWatchSettings(settings).startIn,
        options: () => WATCH_START_MODES.map((value) => ({ value })),
        patch(value) {
            if (!WATCH_START_MODES.includes(value)) throw new TypeError();
            return { watch: { startIn: value } };
        },
    },
};
