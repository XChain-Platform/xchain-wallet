// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useSettingsRootAttributes . Projects the three display-wide
// settings onto <html> so CSS and any component can read them without
// threading props through the whole tree:
//
//   settings.theme          -> data-xc-theme="light" | "dark"   (absent = follow OS)
//   settings.reducedMotion  -> data-xc-reduced-motion="reduce" | "no-preference"
//                                                              (absent = follow OS)
//   settings.learnMode      -> data-xc-learn-mode="on"          (absent = off)
//
// These three shipped as write-only fields: they persisted, validated and
// showed up in the diagnostic dump while nothing rendered them. The attribute
// is the read side. tokens.css keys the palette and the motion switch off the
// first two; LearnNote keys its visibility off the third.
//
// Why a mirror in localStorage: settings live in the encrypted vault, so they
// are unreadable while the wallet is locked. Without the mirror the lock and
// unlock screens would paint in the OS theme and then snap to the chosen one
// after unlock. The mirror holds only display preferences, never anything
// sensitive.

import { useEffect } from 'react';
import { REDUCED_MOTION_ATTR } from '../../ui/reducedMotion.js';

export const THEME_ATTR = 'data-xc-theme';
export const LEARN_MODE_ATTR = 'data-xc-learn-mode';
const CACHE_KEY = 'xc:displayPrefs';

/**
 * @typedef {object} DisplayPrefs
 * @property {'system'|'light'|'dark'} [theme]
 * @property {'auto'|'always'|'never'} [reducedMotion]
 * @property {boolean} [learnMode]
 */

function setAttr(name, value) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (!root || typeof root.setAttribute !== 'function') return;
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
}

/** `system` (or anything unrecognised) means "follow the OS", i.e. no attribute. */
function themeAttrValue(theme) {
    return theme === 'light' || theme === 'dark' ? theme : null;
}

/** Maps the setting's vocabulary onto the CSS media-query vocabulary. */
function reducedMotionAttrValue(mode) {
    if (mode === 'always') return 'reduce';
    if (mode === 'never') return 'no-preference';
    return null;
}

/**
 * Stamp the three attributes on <html>. Exported for direct use by tests and
 * by shells that want to apply a cached preference before React mounts.
 *
 * @param {DisplayPrefs | null | undefined} prefs
 */
export function applySettingsRootAttributes(prefs) {
    setAttr(THEME_ATTR, themeAttrValue(prefs?.theme));
    setAttr(REDUCED_MOTION_ATTR, reducedMotionAttrValue(prefs?.reducedMotion));
    setAttr(LEARN_MODE_ATTR, prefs?.learnMode ? 'on' : null);
}

/** @returns {DisplayPrefs | null} the last preferences seen while unlocked */
export function readCachedDisplayPrefs() {
    try {
        const raw = globalThis.localStorage?.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

/** @param {DisplayPrefs} prefs */
export function cacheDisplayPrefs(prefs) {
    try {
        globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify({
            theme: prefs?.theme,
            reducedMotion: prefs?.reducedMotion,
            learnMode: Boolean(prefs?.learnMode),
        }));
    } catch { /* storage may be blocked in some shells */ }
}

/**
 * @param {import('../../schemas/settings.js').Settings | null | undefined} settings
 *        the live record, or null while the vault is locked / still loading
 */
export function useSettingsRootAttributes(settings) {
    const theme = settings?.theme;
    const reducedMotion = settings?.reducedMotion;
    const learnMode = settings?.learnMode;

    useEffect(() => {
        if (!settings) {
            // Locked or still loading: fall back to whatever the user chose
            // last time, so the unlock screen already paints in their theme.
            applySettingsRootAttributes(readCachedDisplayPrefs());
            return;
        }
        const prefs = { theme, reducedMotion, learnMode: Boolean(learnMode) };
        applySettingsRootAttributes(prefs);
        cacheDisplayPrefs(prefs);
    }, [settings, theme, reducedMotion, learnMode]);
}
