// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A picked file as a reference main can open without the page naming a path:
// the preload registers it and answers a token, which main redeems once.
export async function desktopFileRefOf(file, bridge) {
    if (typeof file !== 'object' || file === null) return null;

    try {
        const size = file.size;
        if (!Number.isSafeInteger(size) || size < 0) return null;
        const fileTokenOf = bridge?.fileTokenOf;
        if (typeof fileTokenOf !== 'function') return null;
        const issued = await fileTokenOf.call(bridge, file);
        if (typeof issued?.token !== 'string' || issued.token.length === 0) return null;
        if (issued.size !== size) return null;
        return { kind: 'picked', token: issued.token, size };
    } catch {
        return null;
    }
}
