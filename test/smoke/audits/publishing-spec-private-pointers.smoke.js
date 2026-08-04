// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//. Every store-publishing spec has to carry the operator map its
// published pages are forbidden to carry, and every pointer on that map has
// to resolve.
//
// WHAT THIS IS A PORT OF. The documentation standard (§34) bars `claude/`
// paths, XC ids, credentials and store identities from published pages and
// names the owning SPEC as their home instead.  stripped that material
// out of every ceremony page correctly, and on the Chrome lane nothing picked
// it up: for a day the published page told an operator to "log it in the
// correspondence log, in full, before responding" and no document anywhere
// said where that log was.  closed its own instance as spec §4a plus
// §5 of extension-ceremony-collateral.smoke.js.
//
// THE CLASS, WHICH IS WHY THIS FILE EXISTS. Measured 2026-08-03: the Android,
// iOS and desktop specs carried ZERO occurrences of a correspondence log or a
// private-pointer map. The migration removed the pointers from four lanes and
// exactly one of them noticed. So the rule is enforced per lane, from one
// place, over every `wallet-publishing-*.md` there is - including any lane
// added later, which is the point of globbing rather than listing.
//
// WHY IT IS READ ON A CLOCK. None of this blocks a first submission, so it
// looks like tidiness right up to the moment it is not. The map is read on a
// REJECTION, when a store has given us a window (a Play policy notice, an
// Apple resubmission, an MSIX certification failure) and the operator needs
// the accepted-language log and the lever inventory immediately. A dead
// pointer costs a chunk of that window; a missing map costs the whole idea
// that a record was being kept.
//
// THE SCOPING IS INHERITED FROM S23 AND IT IS THE DESIGN POINT. These specs
// are history-bearing documents that deliberately name long-deleted files
// throughout their superseded rows, so a blanket every-path-resolves rule
// would fire on correct writing, and a check that fires on correct writing is
// one people delete (the S14 lesson). ONLY the block that claims to be a live
// map is held to being one.
//
// AND THE ADDRESS IS NOT THE CONTENTS (the S27 lesson). A pointer that
// resolves can still be wrong: the incident-runbook pointer names a section,
// and a section number that does not exist in the runbook sends an operator
// mid-incident to a document that has nothing for their shell in it. That
// half is checked too.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    listSpecs, PLATFORM_ROOT, resolveCitation, skipUnlessSpecs,
} from '../_spec-frontier.js';

skipUnlessSpecs('publishing-spec private-pointers smoke');

// The lanes that must have a map today. Globbing picks up a future lane
// automatically; this list is the guard against the opposite failure, a spec
// being RENAMED out of the glob and silently ceasing to be checked.
const REQUIRED_LANES = [
    'wallet-publishing-android.md',
    'wallet-publishing-chrome-extension.md',
    'wallet-publishing-desktop.md',
    'wallet-publishing-ios.md',
];

const specs = listSpecs().filter((s) => /^wallet-publishing-.*\.md$/.test(s.name));
const names = specs.map((s) => s.name);

for (const lane of REQUIRED_LANES) {
    assert.ok(names.includes(lane),
        `${lane} is not among the publishing specs this gate found (${names.join(', ') || 'none'}). `
        + 'Either the spec was renamed, in which case rename it here in the same change, or it was '
        + 'deleted, in which case its store lane no longer has an operator map and the reason it had '
        + 'one needs recording somewhere before this line is removed.');
}

// --- 1. Each lane's map exists, and every path on it resolves -----------

const CLAUDE_PATH = /`(claude\/[A-Za-z0-9_./-]+)`/g;
const BULLET = /^\s*[-*] /;
const HEADING = /^#{2,3} /;
const MAP_HEADING = /^#{2,3} .*\bprivate pointers\b/i;

/** The private-pointer block of one spec, as its raw markdown. */
function mapBlockOf(text) {
    const lines = text.split('\n');
    const start = lines.findIndex((l) => MAP_HEADING.test(l));
    if (start === -1) return null;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
        if (HEADING.test(lines[i])) { end = i; break; }
    }
    return { heading: lines[start], body: lines.slice(start, end) };
}

const maps = new Map();
const dead = [];
let totalPointers = 0;

for (const { name, text } of specs) {
    const block = mapBlockOf(text);
    assert.ok(block,
        `${name} has no private-pointer block. The docs standard bars claude/ paths, XC ids, `
        + 'credentials and store identities from published pages and names the owning SPEC as their '
        + 'home, so without this block the lane has NO home for them: on a store rejection its '
        + 'operator is told to log the exchange and no document says where. Write it the way '
        + 'wallet-publishing-chrome-extension.md §4a is written, with this lane\'s own '
        + 'correspondence log, and give the heading the words "private pointers" so this gate finds '
        + 'it. If it merely moved, repoint this gate in the same change.');

    const pathsOn = (lines) => [...new Set(
        lines.flatMap((line) => [...line.matchAll(CLAUDE_PATH)].map((m) => m[1])),
    )];

    // Everything in the block is held to resolving, prose included: these
    // blocks cite the Chrome lane's §4a as the precedent, and a dead
    // precedent is the same rot one remove.
    for (const p of pathsOn(block.body)) {
        totalPointers += 1;
        if (!resolveCitation(p).ok) dead.push(`${name} maps ${p}`);
    }

    // The FLOOR counts bullets only. The map's entries are its bullets; a
    // prose citation is an argument, not a destination, and counting one
    // would let a lane drop a real entry and stay above the floor. That is
    // the mutation that caught this, and it is not hypothetical: every lane
    // here cites the Chrome spec in its opening paragraph.
    const entries = pathsOn(block.body.filter((l) => BULLET.test(l)));

    assert.ok(entries.length >= 3,
        `${name}'s private-pointer map lists ${entries.length} pointers, fewer than the three every `
        + 'lane needs (its correspondence log, the incident runbook, the credential-custody rows). A '
        + 'map that loses an entry is exactly how the  migration lost all of them.');

    maps.set(name, { block, entries });
}

assert.equal(dead.length, 0,
    `publishing specs map private pointers that do not exist:\n  ${dead.join('\n  ')}\n`
    + 'These blocks exist because the published store pages cannot name these paths, so the spec is '
    + 'the ONLY place an operator can find them, and it is read on a rejection clock. The Chrome '
    + 'lane\'s map named a correspondence log that had been deleted three days earlier until '
    + '2026-08-03. Repoint it at wherever the artifact went, or create the artifact.');

// --- 2. The two pointers a rejection actually needs ---------------------
//
// A floor of three proves the map has entries. It does not prove it has the
// RIGHT entries, and the two that are read under time pressure are the log
// (what has already been accepted) and the runbook (what levers exist). Held
// by name rather than by count so a lane cannot satisfy the floor with three
// custody rows and no log.

const logs = new Map();
const runbooks = new Map();

/** The one claude/ path on the block's line about <topic>. */
function pointerFor(block, topic, label, name) {
    // BULLETS only. The block's prose legitimately says "correspondence log"
    // while explaining why the block exists, and on three of the four lanes it
    // also cites the Chrome spec as the precedent; reading prose as an entry
    // makes a correctly-written map look like it has two destinations.
    //
    // `topic` only, never CLAUDE_PATH, in the filter: CLAUDE_PATH is global,
    // so testing with it carries lastIndex from line to line and silently
    // skips matches on every line after the first.
    const lines = block.body.filter((l) => BULLET.test(l) && topic.test(l));
    const found = [...new Set(
        lines.flatMap((l) => [...l.matchAll(CLAUDE_PATH)].map((m) => m[1])),
    )];
    assert.ok(found.length > 0,
        `${name}'s private-pointer map names no ${label}. That is the pointer the map exists for: `
        + 'the published page tells an operator to keep the record and log the exchange, and the '
        + 'standard forbids the page from saying where. Add it as a bullet naming a claude/ path.');
    assert.equal(found.length, 1,
        `${name}'s private-pointer map names ${found.length} paths for its ${label} `
        + `(${found.join(', ')}). One lane, one destination: two of them is how half the record ends `
        + 'up in a file nobody reads.');
    return found[0];
}

for (const [name, { block }] of maps) {
    logs.set(name, pointerFor(block, /correspondence log/i, 'correspondence log', name));
    runbooks.set(name, pointerFor(block, /incident runbook/i, 'incident runbook', name));
}

// --- 3. Each lane's log is its OWN ---------------------------------------
//
// The ledger entry that opened this asked for "each lane's own correspondence
// log", and pointing two lanes at one file is the failure that looks most
// like success: every path resolves, the floors pass, and an operator on a
// Play rejection is reading Apple's accepted language.

const owners = new Map();
for (const [name, path] of logs) {
    const already = owners.get(path);
    assert.ok(!already,
        `${name} and ${already} point at the same correspondence log (${path}). Store threads do not `
        + 'merge: a reviewer\'s accepted wording is accepted by THAT store, and a shared log buries '
        + 'the entries the operator needs under the ones they do not. Give this lane its own file.');
    owners.set(path, name);
}

// --- 4. The runbook pointer's CONTENTS, not just its address ------------
//
// S27's finding on the Chrome lane, one layer over: a pointer that resolves
// perfectly can still be wrong, and the version of that which bites here is a
// runbook pointer naming a section the runbook does not have. It resolves, it
// reads as authoritative, and it hands a mid-incident operator a document
// with nothing for their shell in it. No path check can see that.

const sections = new Map();

for (const [name, path] of runbooks) {
    const line = maps.get(name).block.body
        .find((l) => BULLET.test(l) && /incident runbook/i.test(l) && l.includes(path));
    const cited = line.match(/§\s*(\d+)/);
    assert.ok(cited,
        `${name}'s incident-runbook pointer (${path}) names no section. The runbook is a fleet-wide `
        + 'document with a section per incident class, so "read the runbook" during an incident is '
        + 'the same as no pointer at all. Name the section, as §<n>.');

    const n = cited[1];
    const runbook = readFileSync(join(PLATFORM_ROOT, path), 'utf8');
    assert.ok(new RegExp(`^## ${n}\\. `, 'm').test(runbook),
        `${name} sends an operator to §${n} of ${path}, and that section does not exist. The path `
        + 'resolves, which is exactly what makes this the expensive kind of dead pointer: it is '
        + 'followed successfully, mid-incident, into a document with nothing for this shell in it. '
        + 'Either write the section or repoint the citation.');

    const already = sections.get(n);
    assert.ok(!already,
        `${name} and ${already} both cite §${n} of the incident runbook. The shells do not share a `
        + 'lever inventory - Play has a staged-rollout halt, iOS has no rollback at all, and desktop '
        + 'owns its own update feed - so one section cannot be the answer for two of them.');
    sections.set(n, name);
}

// --- 5. The ways this gate could pass without checking anything ---------
//
// Each is a real regression path. The resolver has a git-tip fallback (a
// sibling checkout is routinely behind its own origin), so "it resolved" is
// worth proving against a path that must NOT resolve; and a glob that stops
// matching turns every loop above into a no-op that reports success.

assert.ok(specs.length >= REQUIRED_LANES.length,
    `only ${specs.length} publishing specs matched, fewer than the ${REQUIRED_LANES.length} lanes `
    + 'that exist. Every assertion in this gate is inside a loop over that list, so a glob that '
    + 'stops matching is a gate that passes while checking nothing.');

assert.ok(totalPointers >= 3 * REQUIRED_LANES.length,
    `${totalPointers} pointers were checked across ${specs.length} specs, below the floor the lanes `
    + 'were written with. A block that stops being recognised as a map still has a heading, so the '
    + 'count is what notices.');

assert.equal(resolveCitation('claude/reports/xchain-wallet/__no-such-report__.md').ok, false,
    'the resolver reports a path that cannot exist as resolving, so section 1 proves nothing. It '
    + 'falls back to the committed tips of every sibling checkout, which is deliberate (a sibling is '
    + 'routinely behind its own origin), and this line is what keeps that fallback from swallowing '
    + 'genuinely dead pointers.');

console.log(`OK publishing-spec private pointers (${specs.length} lanes, ${totalPointers} pointers `
    + `resolved, ${logs.size} distinct correspondence logs, ${sections.size} incident-runbook `
    + 'sections verified to exist)');
