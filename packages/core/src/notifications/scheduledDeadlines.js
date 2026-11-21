// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function planDeadlineSchedule(items, {
    now,
    windowSeconds = 86400,
    limit = 48,
}) {
    return items
        .filter(({ deadlineMs }) => Number.isFinite(deadlineMs) && deadlineMs > now)
        .map(({ key, deadlineMs }) => ({
            key,
            deadlineMs,
            id: `deadline:${key}`,
            at: Math.max(now + 60_000, deadlineMs - windowSeconds * 1000),
        }))
        .sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .slice(0, Math.max(0, limit));
}

export function diffDeadlineSchedule(previousIds, plan) {
    const previous = new Set(previousIds);
    const planned = new Set(plan.map(({ id }) => id));
    return {
        schedule: plan.filter(({ id }) => !previous.has(id)),
        cancel: previousIds.filter((id) => !planned.has(id)),
    };
}
