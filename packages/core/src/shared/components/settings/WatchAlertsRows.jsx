// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { resolveWatchSettings } from '../../../schemas/settings.js';

export function backgroundCheckRowState(settings) {
    return {
        on: resolveWatchSettings(settings).backgroundActivityCheck,
        locked: settings?.privacy?.torRouting === true,
    };
}

export function summarizeRunLog(times, { limit = 20 } = {}) {
    if (!Array.isArray(times)) return { count: 0, times: [] };

    const max = Math.max(0, Math.trunc(limit));
    const kept = times
        .filter(time => typeof time === 'number' && Number.isFinite(time) && time >= 0)
        .sort((a, b) => b - a)
        .slice(0, max);

    return { count: kept.length, times: kept };
}
