// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { POST_DEMO_INTENT_KEY } from './demoGraduation.js';

/** The selected restore form to open after the locked vault is erased. */
export const FORGOT_PASSWORD_RESTORE_LANE_KEY = 'xc:forgotPasswordRestoreLane';

const RESTORE_LANES = ['mnemonic', 'backup'];

/**
 * Carry the selected restore form across the reload required after a vault wipe.
 * Both values are written together so the app never enters Import without the
 * recovery choice that led there.
 *
 * @param {'mnemonic' | 'backup'} lane
 */
export function setForgotPasswordRestoreIntent(lane) {
    if (!RESTORE_LANES.includes(lane)) return;
    try {
        const storage = globalThis.localStorage;
        if (!storage) return;
        storage.setItem(FORGOT_PASSWORD_RESTORE_LANE_KEY, lane);
        storage.setItem(POST_DEMO_INTENT_KEY, 'import');
    } catch {
        try {
            globalThis.localStorage?.removeItem(FORGOT_PASSWORD_RESTORE_LANE_KEY);
            globalThis.localStorage?.removeItem(POST_DEMO_INTENT_KEY);
        } catch { /* best-effort cleanup */ }
    }
}

/**
 * Read and clear the selected restore form, falling back to the caller's lane.
 *
 * @param {'mnemonic' | 'backup'} fallback
 * @returns {'mnemonic' | 'backup'}
 */
export function takeForgotPasswordRestoreLane(fallback = 'mnemonic') {
    let lane = null;
    try {
        lane = globalThis.localStorage?.getItem(FORGOT_PASSWORD_RESTORE_LANE_KEY) || null;
        globalThis.localStorage?.removeItem(FORGOT_PASSWORD_RESTORE_LANE_KEY);
    } catch {
        return fallback;
    }
    return RESTORE_LANES.includes(lane) ? /** @type {any} */ (lane) : fallback;
}
