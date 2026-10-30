// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The operator's UI rulings as countable layout findings, and the allowlist
// that holds the open ones. tests/layout/rulings-gate.spec.js walks every
// screen and fails on a count the allowlist does not hold;
// test/unit/layout/rulingsAllowlist.test.js keeps the allowlist from growing.
//
// Allowlist shape (tests/layout/rulings.allowlist.json):
//   { "<key>": { "ruling": "U11", "rule": "...",
//                "screens": { "<venue> | <screen label>": { "count": 2, "reason": "..." } } } }
// Ruling ids follow the order of the operator's UI rulings list
// (U01 to U30); one ruling can own several keys.

import { layoutSweepFindings } from './sweep.js';

/** Every key the gate counts, with the ruling it measures. */
export const RULING_KEYS = Object.freeze({
    unreachable: { ruling: 'U01', rule: 'Every screen fits: no content below the fold that nothing lets you reach' },
    contentEdge: { ruling: 'U02', rule: 'Lists, cards and tables fill the content width up to the scrollbar' },
    headerRows: { ruling: 'U11', rule: 'The app header is one row at every width' },
    borderlessFields: { ruling: 'U14', rule: 'Form fields show borders' },
    noticesInHeader: { ruling: 'U15', rule: 'Toolbars never carry notices' },
    noticePlacement: { ruling: 'U15', rule: 'A notice is the first item of page content, full content width' },
    dashedBorders: { ruling: 'U16', rule: 'No dotted or dashed borders' },
    offTokenCards: { ruling: 'U16', rule: 'Every card uses the card border and radius tokens' },
    backBesideSidebar: { ruling: 'U17', rule: 'No Back on a screen the visible sidebar links to' },
    repeatedText: { ruling: 'U18', rule: 'Screens never repeat titles or help text' },
    pageScrollX: { ruling: 'U19', rule: 'Nothing scrolls the page sideways' },
    headerScrolledAway: { ruling: 'U19', rule: 'The header and navigation never scroll away' },
    fieldButtonsOutside: { ruling: 'U24', rule: 'No Paste buttons; Max sits inside its amount field' },
});

/** The allowlist key of one screen in one venue. */
export const screenKey = (venue, label) => `${venue} | ${label}`;

/**
 * Counts per key per screen for one venue's sweep results:
 * { [key]: { [screenKey]: count } }, only counts above zero.
 */
export function countRulings(venue, screens) {
    const counts = Object.fromEntries(Object.keys(RULING_KEYS).map((key) => [key, {}]));
    const bump = (key, label, n) => {
        if (!n) return;
        const id = screenKey(venue, label);
        counts[key][id] = (counts[key][id] || 0) + n;
    };
    for (const screen of screens) {
        for (const [key, list] of Object.entries(screen.rulings || {})) {
            if (key in counts) bump(key, screen.label, list.length);
        }
        // Sideways scroll is one fault per screen however many pixels it runs.
        bump('pageScrollX', screen.label, screen.pageScrollX > 0 ? 1 : 0);
        bump('unreachable', screen.label, (screen.unreachable || []).length);
    }
    for (const finding of layoutSweepFindings(screens)) {
        if (finding.screen && (finding.key === 'headerScrolledAway' || finding.key === 'contentEdge')) bump(finding.key, finding.screen, 1);
    }
    for (const key of Object.keys(counts)) if (Object.keys(counts[key]).length === 0) delete counts[key];
    return counts;
}

/** One line per count the allowlist does not hold. */
export function allowlistOverruns(counts, allowlist) {
    const out = [];
    for (const [key, screens] of Object.entries(counts)) {
        for (const [id, count] of Object.entries(screens)) {
            const allowed = allowlist[key]?.screens?.[id]?.count ?? 0;
            if (count > allowed) {
                out.push(`${RULING_KEYS[key]?.ruling ?? '?'} ${key} on ${id}: ${count} found, ${allowed} allowed`);
            }
        }
    }
    return out;
}

/** Allowlist entries whose screen measured below its count, for the run log. */
export function allowlistSlack(counts, allowlist, venue) {
    const out = [];
    for (const [key, entry] of Object.entries(allowlist)) {
        for (const [id, { count }] of Object.entries(entry.screens || {})) {
            if (!id.startsWith(`${venue} | `)) continue;
            const found = counts[key]?.[id] ?? 0;
            if (found < count) out.push(`${entry.ruling} ${key} on ${id}: ${found} found, ${count} allowed`);
        }
    }
    return out;
}

/**
 * An allowlist holding the largest count of each screen over several
 * measured runs, every entry with `reason`.
 */
export function seedAllowlist(runs, reason) {
    const out = {};
    for (const counts of runs) {
        for (const [key, screens] of Object.entries(counts)) {
            out[key] ??= { ...RULING_KEYS[key], screens: {} };
            for (const [id, count] of Object.entries(screens)) {
                const prior = out[key].screens[id]?.count ?? 0;
                out[key].screens[id] = { count: Math.max(prior, count), reason };
            }
        }
    }
    const sorted = {};
    for (const key of Object.keys(RULING_KEYS)) {
        if (!out[key]) continue;
        sorted[key] = {
            ...out[key],
            screens: Object.fromEntries(Object.entries(out[key].screens).sort(([a], [b]) => a.localeCompare(b))),
        };
    }
    return sorted;
}

/**
 * What `current` holds beyond `base`: a new key, a new screen, or a larger
 * count. Each is one line. An empty list means the allowlist only shrank.
 */
export function allowlistGrowth(base, current) {
    const out = [];
    const totals = (list) => {
        const byRuling = {};
        for (const entry of Object.values(list)) {
            for (const { count } of Object.values(entry.screens || {})) {
                byRuling[entry.ruling] = (byRuling[entry.ruling] || 0) + count;
            }
        }
        return byRuling;
    };
    for (const [key, entry] of Object.entries(current)) {
        for (const [id, { count }] of Object.entries(entry.screens || {})) {
            const prior = base[key]?.screens?.[id]?.count;
            if (prior === undefined) out.push(`${key} on ${id}: new entry`);
            else if (count > prior) out.push(`${key} on ${id}: ${prior} to ${count}`);
        }
    }
    const before = totals(base);
    for (const [ruling, total] of Object.entries(totals(current))) {
        if (total > (before[ruling] || 0)) out.push(`${ruling}: ${before[ruling] || 0} to ${total} allowed in all`);
    }
    return out;
}
