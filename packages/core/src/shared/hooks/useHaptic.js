// useHaptic — §37.3 / G120. Thin wrapper around the Vibration API
// (`navigator.vibrate`) that exposes intent-named pulses (success,
// warn, error, tap) instead of leaving callers to guess pattern
// constants. Returns a stable API regardless of host capability — on
// a desktop browser without vibration support, every method silently
// no-ops, so callers don't have to feature-detect.
//
// Reduced-motion guard: subscribes to the `prefers-reduced-motion`
// media query (same pattern AnimatedQrFrames uses) and suppresses
// every pulse while the user has the OS preference enabled. Vibration
// is a motion affordance — users who turn motion off are signalling
// they don't want involuntary feedback either.
//
// The hook deliberately does NOT add a Settings field. Spec §37.3
// scopes haptics to "use the platform's haptic API where available";
// honouring `prefers-reduced-motion` is the platform-level opt-out.
// A dedicated wallet toggle can land later if real users ask.

import { useCallback, useEffect, useState } from 'react';

const PATTERNS = Object.freeze({
    tap: 10,
    success: [10, 40, 10],
    warn: [20, 60, 20],
    error: [40, 80, 40, 80, 40],
});

function readReducedMotion() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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
    const [reducedMotion, setReducedMotion] = useState(readReducedMotion);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const onChange = (e) => setReducedMotion(e.matches);
        if (typeof mq.addEventListener === 'function') {
            mq.addEventListener('change', onChange);
            return () => mq.removeEventListener('change', onChange);
        }
        if (typeof mq.addListener === 'function') {
            mq.addListener(onChange);
            return () => mq.removeListener(onChange);
        }
        return undefined;
    }, []);

    const fire = useCallback((pattern) => {
        if (reducedMotion) return;
        safeVibrate(pattern);
    }, [reducedMotion]);

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
