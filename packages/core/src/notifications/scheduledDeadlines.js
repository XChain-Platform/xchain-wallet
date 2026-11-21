// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function planDeadlineSchedule(items, {
    now,
    windowSeconds = 86400,
    limit = 48,
}) {
    return items
        .filter(({ deadlineMs }) => Number.isFinite(deadlineMs) && deadlineMs > now)
        .map((item) => ({
            ...item,
            id: `deadline:${item.key}`,
            at: Math.max(now + 60_000, item.deadlineMs - windowSeconds * 1000),
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

export async function syncDeadlineSchedule(items, {
    notify,
    previousIds = [],
    now = Date.now(),
    windowSeconds = 86400,
    limit = 48,
} = {}) {
    if (typeof notify?.schedule !== 'function' || typeof notify.cancel !== 'function') {
        throw new TypeError('syncDeadlineSchedule requires a schedulable notify adapter');
    }

    const plan = planDeadlineSchedule(items, { now, windowSeconds, limit });
    const changes = diffDeadlineSchedule(previousIds, plan);

    await Promise.all(changes.cancel.map((id) => notify.cancel(id)));
    await Promise.all(changes.schedule.map((entry) => {
        const {
            key: _key,
            deadlineMs: _deadlineMs,
            ...scheduled
        } = entry;
        return notify.schedule(scheduled, entry.at);
    }));

    return plan;
}
