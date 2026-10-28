// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Counting for the control-row gate (control-rows.spec.js, ruling U07:
// controls sharing a row line up). Findings are counted per screen as
// "<venue> | <route>" and held to control-rows.allowlist.json, which lists
// the screens whose rows stay mismatched on purpose, each with its reason.
// The allowlist only shrinks (test/unit/layout/controlRowsAllowlist.test.js).

/** Findings per "<venue> | <route>". */
export function countControlRows(venue, findings) {
    const counts = {};
    for (const finding of findings) {
        const id = `${venue} | ${finding.route}`;
        counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
}

/** Screens holding more findings than the allowlist lets them. */
export function controlRowOverruns(counts, allowlist) {
    return Object.entries(counts)
        .filter(([id, count]) => count > (allowlist.screens?.[id]?.count ?? 0))
        .map(([id, count]) => `${id}: ${count} (allowlist ${allowlist.screens?.[id]?.count ?? 0})`);
}

/** Allowlist entries for this venue that the run no longer needs in full. */
export function controlRowSlack(counts, allowlist, venue) {
    return Object.entries(allowlist.screens || {})
        .filter(([id]) => id.startsWith(`${venue} | `))
        .filter(([id, entry]) => (counts[id] || 0) < entry.count)
        .map(([id, entry]) => `${id}: ${counts[id] || 0} (allowlist ${entry.count})`);
}

/** Entries `next` adds or raises against `base`. */
export function controlRowAllowlistGrowth(base, next) {
    const growth = [];
    for (const [id, entry] of Object.entries(next.screens || {})) {
        const before = base.screens?.[id]?.count;
        if (before === undefined) growth.push(`${id}: new entry`);
        else if (entry.count > before) growth.push(`${id}: ${before} -> ${entry.count}`);
    }
    return growth;
}
