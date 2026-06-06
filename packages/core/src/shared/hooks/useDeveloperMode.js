// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// useDeveloperMode — convenience accessor that returns the live
// `settings.developerMode` flag. Returns `false` while settings are
// loading or unavailable so caller logic that gates feature reveal
// (regtest chains, raw PSBT inspector, custom-endpoint UI) defaults
// to the "hidden" branch on cold start.
//
// Backed by `useSettings()` so it inherits its messaging-aware
// fallbacks; consumers never see a partial `settings` object.

import { useSettings } from './useSettings.js';

/** @returns {{ developerMode: boolean, ready: boolean, error: Error | null }} */
export function useDeveloperMode() {
    const { settings, loading, error } = useSettings();
    const developerMode = Boolean(settings?.developerMode);
    return { developerMode, ready: !loading && !error && Boolean(settings), error };
}
