// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export function duoViewports(measured) {
    if (measured === null || typeof measured !== 'object' || Array.isArray(measured)) return [];
    if (measured.states === null || typeof measured.states !== 'object' || Array.isArray(measured.states)) return [];

    const names = ['closed-portrait', 'closed-landscape', 'open-portrait', 'open-landscape'];
    const viewports = [];

    for (const state of names) {
        const value = measured.states[state];
        if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
        if (value.unreachable === true) continue;
        if (!Number.isFinite(value.width) || value.width <= 0) continue;
        if (!Number.isFinite(value.height) || value.height <= 0) continue;

        const width = Math.round(value.width);
        const height = Math.round(value.height);
        if (width <= 0 || height <= 0) continue;

        viewports.push({
            name: `Duo ${state}`,
            state,
            width,
            height,
            division: value.division,
        });
    }

    return viewports;
}
