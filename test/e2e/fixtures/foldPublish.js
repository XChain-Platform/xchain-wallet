// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export function foldPayloadFor(viewport) {
    if (viewport === null || typeof viewport !== 'object' || Array.isArray(viewport)) return null;

    const closed = viewport.state === 'closed-portrait' || viewport.state === 'closed-landscape';
    const open = viewport.state === 'open-portrait' || viewport.state === 'open-landscape';
    if (!closed && !open) return null;

    const division = viewport.division;
    const validDivision = division !== null
        && typeof division === 'object'
        && ['vertical', 'horizontal', 'none'].includes(division.orientation)
        && [division.x, division.y, division.width, division.height]
            .every((value) => Number.isFinite(value) && value >= 0);

    return {
        posture: closed ? 'closed' : 'open',
        division: validDivision
            ? division
            : { orientation: 'none', x: 0, y: 0, width: 0, height: 0 },
        display: closed ? 'outer' : 'inner',
    };
}

export function publishNativeFold(payload) {
    if (payload === null) delete globalThis.__xchainNativeFold;
    else globalThis.__xchainNativeFold = payload;
    globalThis.dispatchEvent(new globalThis.CustomEvent('xchain:native-fold', { detail: payload }));
}

export function assignNativeFold(payload) {
    globalThis.__xchainNativeFold = payload;
}

export function setNativeFold(page, payload) {
    return page.evaluate(publishNativeFold, payload);
}

export function seedNativeFold(page, payload) {
    return page.addInitScript(assignNativeFold, payload);
}
