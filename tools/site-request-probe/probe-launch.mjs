// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

function isEntry(value) {
    return value !== null
        && typeof value === 'object'
        && !Array.isArray(value)
        && typeof value.type === 'string';
}

function isLaunch(entry) {
    return entry.type === 'launch-attempt'
        || entry.type === 'anchor-launch'
        || entry.type === 'redirect-attempt';
}

function isExcludedLaunch(entry) {
    return entry.type === 'redirect-attempt'
        || (entry.type === 'launch-attempt' && entry.launchType === 'http-302-entry')
        || (entry.type === 'anchor-launch'
            && ['redirect-anchor', 'script-source'].includes(entry.control));
}

function activationValue(entry) {
    return typeof entry.userActivationActive === 'boolean'
        ? entry.userActivationActive
        : null;
}

function losesFocus(entry) {
    return entry.type === 'blur'
        || entry.type === 'pagehide'
        || (entry.type === 'visibilitychange' && entry.visibility === 'hidden');
}

function parseTime(value) {
    try {
        return Date.parse(value);
    } catch {
        return Number.NaN;
    }
}

function isWithinWindow(launch, event, windowMs) {
    const launchTime = parseTime(launch.time);
    const eventTime = parseTime(event.time);
    if (Number.isNaN(launchTime) || Number.isNaN(eventTime)) return true;

    const elapsed = eventTime - launchTime;
    return elapsed >= 0 && elapsed <= windowMs;
}

export function summarizeLaunches(entries, { windowMs = 2000 } = {}) {
    if (!Array.isArray(entries)) return [];

    const events = entries.filter(isEntry);
    const summaries = [];

    for (let index = 0; index < events.length; index += 1) {
        const launchEntry = events[index];
        if (!isLaunch(launchEntry) || isExcludedLaunch(launchEntry)) continue;

        let end = index + 1;
        while (end < events.length && !isLaunch(events[end])) end += 1;
        const following = events.slice(index + 1, end);
        const launch = launchEntry.type === 'launch-attempt'
            ? launchEntry.launchType
            : launchEntry.control;
        const result = launchEntry.type === 'launch-attempt'
            ? following.find((entry) => entry.type === 'launch-result'
                && entry.launchType === launch)
            : undefined;
        const focusLost = following.some((entry) => losesFocus(entry)
            && isWithinWindow(launchEntry, entry, windowMs));

        summaries.push({
            kind: launchEntry.type === 'launch-attempt' ? 'script' : 'anchor',
            launch,
            target: typeof launchEntry.target === 'string' ? launchEntry.target : null,
            userActivationActive: activationValue(launchEntry),
            popupBlocked: result && typeof result.popupReturnedNull === 'boolean'
                ? result.popupReturnedNull
                : null,
            lostFocus: following.length === 0 ? null : focusLost,
        });
    }

    return summaries;
}
