// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const MIN_FONT_SCALE = 1;
const MAX_FONT_SCALE = 1.5;
const NATIVE_EVENT = 'xchain:native-font-scale';
const PLUGIN_EVENT = 'fontScaleChanged';

/** Bound native accessibility preferences to the range the fixed shell supports. */
export function clampNativeFontScale(value) {
    const scale = Number(value);
    if (!Number.isFinite(scale)) return MIN_FONT_SCALE;
    return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, scale));
}

/** Apply the native preference through the rem basis used by shared type tokens. */
export function applyNativeFontScale(value, root = globalThis.document?.documentElement) {
    const scale = clampNativeFontScale(value);
    if (!root) return scale;
    root.style.setProperty('--xc-native-font-scale', String(scale));
    root.style.fontSize = `${Number((scale * 100).toFixed(4))}%`;
    return scale;
}

/** Connect cold-start values and live native updates to the shared rem scale. */
export function installNativeFontScale(target = globalThis) {
    const applyPayload = (payload = {}) => applyNativeFontScale(
        payload.fontScale ?? payload.detail?.fontScale,
        target.document?.documentElement,
    );
    const initial = target.__xchainNativeFontScale;
    if (initial !== undefined) applyNativeFontScale(initial, target.document?.documentElement);
    target.addEventListener?.(NATIVE_EVENT, applyPayload);

    const capacitor = target.Capacitor;
    let native = false;
    try {
        native = typeof capacitor?.isNativePlatform === 'function'
            && capacitor.isNativePlatform();
    } catch { /* the DOM event remains available when a native probe fails */ }
    const app = native ? capacitor.Plugins?.App : null;
    if (typeof app?.addListener === 'function') {
        try {
            Promise.resolve(app.addListener(PLUGIN_EVENT, applyPayload)).catch(() => null);
        } catch { /* the cold-start value remains applied */ }
    }
    if (typeof app?.getFontScale === 'function') {
        try {
            Promise.resolve(app.getFontScale()).then(applyPayload).catch(() => {});
        } catch { /* a retained event can still deliver the current value */ }
    }
}
