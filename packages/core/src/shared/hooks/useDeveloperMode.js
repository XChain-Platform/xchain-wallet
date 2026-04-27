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
