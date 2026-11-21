// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function groupAddress(address) {
    if (typeof address !== 'string') return '';

    const trimmed = address.trim();
    return trimmed.match(/.{1,4}/g)?.join(' ') ?? '';
}
