// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

function assertFinite(value, name) {
    if (!Number.isFinite(value)) {
        throw new TypeError(`${name} must be finite`);
    }
}

export function undoSendRemainingSeconds({ startedAt, seconds, now }) {
    assertFinite(startedAt, 'startedAt');
    assertFinite(seconds, 'seconds');
    assertFinite(now, 'now');

    const remaining = Math.ceil((startedAt + seconds * 1000 - now) / 1000);
    return Math.min(seconds, Math.max(0, remaining));
}

export function undoSendExpired(input) {
    return undoSendRemainingSeconds(input) === 0;
}
