// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Small uuid helper. Service-worker contexts have `crypto.randomUUID`,
// but tests in older Node versions may not. Falling back to a v4-looking
// string built from `crypto.getRandomValues` keeps the broker testable
// without assumptions about the runtime.

export function sessionRandomUUID() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    // Per RFC 4122 §4.4 (version 4 / variant 10).
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return (
        `${hex.slice(0, 4).join('')}-` +
        `${hex.slice(4, 6).join('')}-` +
        `${hex.slice(6, 8).join('')}-` +
        `${hex.slice(8, 10).join('')}-` +
        `${hex.slice(10, 16).join('')}`
    );
}
