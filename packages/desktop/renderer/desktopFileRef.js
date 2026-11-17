// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

export function desktopFileRefOf(file, bridge) {
    if (typeof file !== 'object' || file === null) return null;

    try {
        const size = file.size;
        if (!Number.isSafeInteger(size) || size < 0) return null;
        const filePathOf = bridge?.filePathOf;
        if (typeof filePathOf !== 'function') return null;
        const path = filePathOf.call(bridge, file);
        if (typeof path !== 'string' || path.length === 0) return null;
        return { kind: 'path', path, size };
    } catch {
        return null;
    }
}
