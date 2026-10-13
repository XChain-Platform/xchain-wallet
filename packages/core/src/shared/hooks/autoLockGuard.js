// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export const AUTO_LOCK_GUARD_CHANGED_EVENT = 'xc:auto-lock-guard-changed';

let activeOperations = 0;

function notify() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(AUTO_LOCK_GUARD_CHANGED_EVENT, {
        detail: { active: activeOperations > 0 },
    }));
}

/**
 * Keep auto-lock from clearing signer material during an approved operation.
 * The returned release is idempotent so every terminal path can call it.
 */
export function holdAutoLock() {
    activeOperations += 1;
    notify();
    let released = false;
    return () => {
        if (released) return;
        released = true;
        activeOperations = Math.max(0, activeOperations - 1);
        notify();
    };
}

export function isAutoLockHeld() {
    return activeOperations > 0;
}
