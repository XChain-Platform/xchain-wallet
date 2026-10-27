// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// LocaleSync (Cluster R FOLLOWUP 4).
//
// Bootstrap shim that flips the live i18n locale to whatever
// `settings.language` carries. Mounted as a sibling under
// MessagingProvider so it runs in every shell (extension popup, web,
// desktop) without per-shell wiring.
//
// Behavior:
//   - On settings load (cold start): if `settings.language` is a
//     registered locale, apply it and align the document's lang and dir
//     attributes even when that locale is already active.
//   - On settings change (e.g. user edits LanguageRegionSection):
//     keep the live locale and document metadata in lockstep with the
//     persisted value.
//
// Settings live in the encrypted vault, so the lock screen cannot read
// `settings.language`. Like the display prefs mirror, the language is cached
// in localStorage while the wallet is unlocked and replayed while settings
// are unreadable, so a reload paints the lock screen in the chosen language
// and direction instead of English. The mirror holds a locale code only.
//
// The Settings panel's own change handler also calls setLocale eagerly
// for an instant UI flip; this component is the cold-start safety net
// + cross-tab coverage. Unknown locale codes are silently ignored;
// missing keys already fall back to English at render time.

import { useEffect } from 'react';
import { useSettings } from './hooks/useSettings.js';
import {
    availableLocales,
    getLocale,
    setLocale,
    syncDocumentLocale,
} from '../i18n/index.js';

export const LANGUAGE_CACHE_KEY = 'xc:language';

/** @returns {string | null} the language chosen the last time settings were readable */
export function readCachedLanguage() {
    try {
        const code = globalThis.localStorage?.getItem(LANGUAGE_CACHE_KEY);
        return typeof code === 'string' && code.length > 0 ? code : null;
    } catch {
        return null;
    }
}

function cacheLanguage(code) {
    try {
        if (code) globalThis.localStorage?.setItem(LANGUAGE_CACHE_KEY, code);
        else globalThis.localStorage?.removeItem(LANGUAGE_CACHE_KEY);
    } catch { /* storage may be blocked in some shells */ }
}

export function LocaleSync() {
    const { settings } = useSettings();
    const settingsLanguage = settings?.language;
    const hasSettings = Boolean(settings);
    // Locked or still loading: fall back to the cached choice.
    const language = hasSettings ? settingsLanguage : readCachedLanguage();
    useEffect(() => {
        if (hasSettings) cacheLanguage(typeof settingsLanguage === 'string' ? settingsLanguage : null);
        if (typeof language !== 'string' || language.length === 0) return;
        if (!availableLocales().includes(language)) return;
        if (getLocale() === language) {
            syncDocumentLocale(language);
            return;
        }
        try { setLocale(language); } catch (_err) { /* never bubble */ }
    }, [language, hasSettings, settingsLanguage]);
    return null;
}
