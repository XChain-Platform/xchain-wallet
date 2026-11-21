// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { resolveWatchSettings } from '../schemas/settings.js';

export function buildWatchSettings(settings) {
    const watch = resolveWatchSettings(settings);

    return {
        showTotal: watch.showTotal,
        enabled: watch.enabled,
    };
}
