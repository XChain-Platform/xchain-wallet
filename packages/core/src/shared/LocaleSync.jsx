// LocaleSync — Cluster R FOLLOWUP 4.
//
// Bootstrap shim that flips the live i18n locale to whatever
// `settings.language` carries. Mounted as a sibling under
// MessagingProvider so it runs in every shell (extension popup, web,
// desktop) without per-shell wiring.
//
// Behavior:
//   - On settings load (cold start): if `settings.language` is a
//     registered locale that differs from the current locale, call
//     `setLocale(language)`.
//   - On settings change (e.g. user edits LanguageRegionSection):
//     same — keep the live locale in lockstep with the persisted value.
//
// The Settings panel's own change handler also calls setLocale eagerly
// for an instant UI flip; this component is the cold-start safety net
// + cross-tab coverage. Unknown locale codes are silently ignored —
// missing keys already fall back to English at render time.

import { useEffect } from 'react';
import { useSettings } from './hooks/useSettings.js';
import {
    availableLocales,
    getLocale,
    setLocale,
} from '../i18n/index.js';

export function LocaleSync() {
    const { settings } = useSettings();
    const language = settings?.language;
    useEffect(() => {
        if (typeof language !== 'string' || language.length === 0) return;
        if (!availableLocales().includes(language)) return;
        if (getLocale() === language) return;
        try { setLocale(language); } catch (_err) { /* never bubble */ }
    }, [language]);
    return null;
}
