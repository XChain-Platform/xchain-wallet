// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

const utf8JsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

export function fitSnapshotBudget(snapshot, budgetBytes) {
    const fitted = { ...snapshot, rows: [...snapshot.rows] };

    while (fitted.rows.length > 0 && utf8JsonBytes(fitted) > budgetBytes) {
        fitted.rows.pop();
        fitted.capped = true;
    }

    return fitted;
}
