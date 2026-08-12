// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useHaptic: §37.3 / G120. Thin wrapper around the Vibration API
// (`navigator.vibrate`) that exposes intent-named pulses (success,
// warn, error, tap) instead of leaving callers to guess pattern
// constants. Returns a stable API regardless of host capability; on
// a desktop browser without vibration support, every method silently
// no-ops, so callers don't have to feature-detect.
//
// Reduced-motion guard: suppresses every pulse while motion is reduced.
// Vibration is a motion affordance; users who turn motion off are
// signalling they don't want involuntary feedback either.: the
// verdict comes from `useReducedMotion`, which weighs the in-app
// Settings → Appearance override ("Always reduce" / "Never reduce")
// ahead of the OS media query. Reading matchMedia directly, as this hook
// used to, made "Always reduce" unenforceable for anyone whose OS does
// not advertise the preference.
//
// Cluster P FOLLOWUP 1: `settings.privacy.hapticsEnabled` (v2-tolerant,
// default true) is now honored as an in-wallet opt-out alongside the
// OS-level reduced-motion preference. Users who want haptics off
// without disabling motion globally, or whose device's vibration motor
// is harsh enough that the pulses are more annoying than informative,
// can flip it in Settings → Privacy.

import { useCallback } from 'react';
import { useReducedMotion } from '../../ui/reducedMotion.js';
import { useSettings } from './useSettings.js';

const PATTERNS = Object.freeze({
    tap: 10,
    success: [10, 40, 10],
    warn: [20, 60, 20],
    error: [40, 80, 40, 80, 40],
});

function canVibrate() {
    if (typeof navigator === 'undefined') return false;
    return typeof navigator.vibrate === 'function';
}

function safeVibrate(pattern) {
    if (!canVibrate()) return false;
    try {
        return navigator.vibrate(pattern);
    } catch {
        // Some browsers throw on background tabs / permissions-policy
        // restrictions. Treat as a silent no-op rather than crashing
        // the calling form.
        return false;
    }
}

/**
 * @returns {{
 *   tap: () => void,
 *   success: () => void,
 *   warn: () => void,
 *   error: () => void,
 *   vibrate: (pattern: number | number[]) => void,
 *   supported: boolean,
 *   reducedMotion: boolean,
 * }}
 */
export function useHaptic() {
    const reducedMotion = useReducedMotion();
    // Cluster P FOLLOWUP 1: read the in-wallet opt-out. Default-true
    // when the field is absent so existing settings records keep their
    // current behaviour; `=== false` is the only suppress signal.
    const { settings } = useSettings();
    const settingsEnabled = settings?.privacy?.hapticsEnabled !== false;

    const fire = useCallback((pattern) => {
        if (reducedMotion) return;
        if (!settingsEnabled) return;
        safeVibrate(pattern);
    }, [reducedMotion, settingsEnabled]);

    const tap = useCallback(() => fire(PATTERNS.tap), [fire]);
    const success = useCallback(() => fire(PATTERNS.success), [fire]);
    const warn = useCallback(() => fire(PATTERNS.warn), [fire]);
    const error = useCallback(() => fire(PATTERNS.error), [fire]);
    const vibrate = useCallback((pattern) => fire(pattern), [fire]);

    return {
        tap,
        success,
        warn,
        error,
        vibrate,
        supported: canVibrate(),
        reducedMotion,
    };
}

export const HAPTIC_PATTERNS = PATTERNS;
