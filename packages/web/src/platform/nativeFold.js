// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const NATIVE_EVENT = 'xchain:native-fold';
const ORIENTATIONS = new Set(['vertical', 'horizontal']);

function cssPixels(value) {
    const pixels = Number(value);
    return `${Number.isFinite(pixels) ? pixels : 0}px`;
}

export function applyNativeFold(payload, root = globalThis.document?.documentElement) {
    const division = payload?.division;
    const orientation = ORIENTATIONS.has(division?.orientation)
        ? division.orientation
        : 'none';
    if (!root) return orientation;
    root.style.setProperty('--xc-fold-x', cssPixels(division?.x));
    root.style.setProperty('--xc-fold-y', cssPixels(division?.y));
    root.setAttribute('data-fold', orientation);
    return orientation;
}

export function installNativeFold(target = globalThis) {
    const update = (event) => applyNativeFold(
        event?.detail ?? target.__xchainNativeFold,
        target.document?.documentElement,
    );
    applyNativeFold(target.__xchainNativeFold, target.document?.documentElement);
    target.addEventListener?.(NATIVE_EVENT, update);
    return () => target.removeEventListener?.(NATIVE_EVENT, update);
}
