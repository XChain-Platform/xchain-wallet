// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//. Every platform spec's LIVE frontier rows have to cite artifacts
// that exist somewhere in the monorepo.
//
// WHAT THIS IS A PORT OF, AND WHY IT IS NOT A COPY.  built §6 of
// extension-ceremony-collateral.smoke.js after its own frontier rotted twice
// in two stages: S23 found row 3 naming docs/BRIDGE.md, deleted by the
//  documentation migration, and S24 found ROW 1 - the row that IS that
// spec's goal - still telling an operator to execute a runbook the operator's
// own one-home ruling had deleted. The re-scan that closed it then asked
// whether the defect was a class. It was: `wallet-publishing-desktop.md` had a
// live row citing packages/desktop/REPRODUCIBLE_BUILDS.md and
// `wallet-publishing-android.md` one citing packages/mobile/docs/, both moved
// into xchain-documentation by the same migration, neither resolving anywhere
// on disk, and NOTHING checked any spec's frontier except 's.
//
// WHY IT MATTERS BEYOND TIDINESS. A frontier row is what a later stage, or the
// operator, reads to learn what is left. A row naming a deleted artifact does
// not fail loudly; it sends the next reader to nothing, and the reader spends
// the stage rediscovering that. In  it cost two.
//
// The two traps this inherits - a `packages/`//`tools/`//`test/` path is not
// necessarily the wallet repo's, and a checkout is not its repo - live in
// _spec-frontier.js with the evidence that bought them.

import assert from 'node:assert/strict';

import {
    acceptanceCitationsIn, acceptanceLinesOf, citationsIn, frontierRowsOf, listSpecs,
    resolveCitation, skipUnlessSpecs, SPECS_DIR,
} from '../_spec-frontier.js';

skipUnlessSpecs('spec frontier-citations smoke');

const specs = listSpecs();
const withFrontier = [];
const dead = [];
const deadTests = [];
let liveRows = 0;
let citations = 0;
let elided = 0;
let withAcceptance = 0;
let acceptanceLines = 0;
let acceptanceCitations = 0;
let inCommandCitations = 0;
const owners = new Map();

for (const { name, text } of specs) {
    const { found, rows } = frontierRowsOf(text);
    if (!found) continue;                       // a spec need not carry a frontier block
    withFrontier.push(name);

    for (const { id, line } of rows) {
        liveRows += 1;
        const { paths, placeholders } = citationsIn(line);
        elided += placeholders.length;
        for (const cited of paths) {
            citations += 1;
            const { ok, where, ref } = resolveCitation(cited);
            if (!ok) { dead.push(`${name} row ${id} cites ${cited}`); continue; }
            const owner = where.split('/').pop() + (ref ? ` @${ref}` : '');
            owners.set(owner, (owners.get(owner) || 0) + 1);
        }
    }

    // The block's ACCEPTANCE TESTS, which are not rows and were checked by
    // nothing until S47 drove one and found it naming a script that
    // has never been at that path.
    const acceptance = acceptanceLinesOf(text);
    if (!acceptance.found) continue;
    withAcceptance += 1;
    for (const { n, line } of acceptance.lines) {
        acceptanceLines += 1;
        const { paths, placeholders, inCommand } = acceptanceCitationsIn(line);
        elided += placeholders.length;
        inCommandCitations += inCommand.length;
        for (const cited of paths) {
            acceptanceCitations += 1;
            const { ok, where, ref } = resolveCitation(cited);
            if (!ok) { deadTests.push(`${name} acceptance test ${n} cites ${cited}`); continue; }
            const owner = where.split('/').pop() + (ref ? ` @${ref}` : '');
            owners.set(owner, (owners.get(owner) || 0) + 1);
        }
    }
}

assert.equal(dead.length, 0,
    `live frontier rows cite paths that do not exist in any checkout:\n  ${dead.join('\n  ')}\n`
    + 'The frontier is what a later stage, or the operator, reads to find out what is left, so a live '
    + 'row pointing at a deleted file quietly costs a stage. Repoint it at wherever the artifact went '
    + '(the  migration moved most of them to xchain-documentation/components/wallet/). If the '
    + 'row is narrating something that is SUPPOSED to be gone, that is prose rather than a pointer: '
    + 'drop the backticks and say it is deleted, the way the superseded rows do.');

// An acceptance test that cites a dead path is worse than a dead row, and it
// is worth being explicit about why rather than folding it into the assertion
// above. A row sends the next reader to nothing and costs a stage. An
// acceptance test IS the milestone's completion criterion: if its command
// cannot run as written, the milestone it gates cannot be reached by anyone
// following the block, however finished the work underneath is. It fails
// silently in the one direction nobody checks, because a test nobody can run
// is indistinguishable from a test nobody has got to yet.
//
// Measured, not theorised. S47 drove this spec's fifth acceptance
// test and found it reading `node tools/release/remote-code-audit.mjs`; the
// script has always lived at packages/extension/scripts/. The mechanism was
// fine - exit 0 on the real CI zip - so nothing but running it could have told
// anyone. S46 had corrected the SECOND test of the same block for the same
// class of defect, by hand, without gating it, which is how the fifth survived.
assert.equal(deadTests.length, 0,
    `milestone acceptance tests cite paths that do not exist in any checkout:\n  ${deadTests.join('\n  ')}\n`
    + 'An acceptance test is the completion criterion for its milestone, so one naming a path that is '
    + 'not there is unpassable by construction and the milestone cannot be reached by following the '
    + 'block. Repoint it at the real artifact and re-drive it: a test corrected by reading is how the '
    + 'previous one of these survived a stage.');

// --- The three ways this gate could pass without checking anything ------
//
// Each of these is a real regression path, not defensive noise. A rename of
// the delimiter, a scrub of the tables, or a tightening of the citation regex
// would each leave the assertion above passing on an empty set, and a gate
// that passes vacuously is indistinguishable from one that was deleted.

// Lowered 7 -> 6 on 2026-08-04, taking this assertion's own instruction: a
// spec WAS genuinely retired.'s taproot-envelope spec moved to
// claude/specs/resolved/ in fd16bf6 ("the spec is RESOLVED"), carrying its
// frontier block with it, which is the convention the eleven specs already
// there set. So the floor was measuring a population that had legitimately
// shrunk, and it went red on a correct change. Verified rather than assumed:
// the moved file still contains its block, and the six remaining are the five
// publishing/rails specs plus spv-state-subtree.
//
// Found by S30, which is not this gate's lane. It is recorded here
// rather than left red because the alternative is a red gate nobody owns: the
// session that retired the spec had no reason to read this floor, and the
// session that wrote the floor had no way to know the spec would retire.
assert.ok(withFrontier.length >= 6,
    `only ${withFrontier.length} of ${specs.length} specs in ${SPECS_DIR} carry a BUILD-SPEC:FRONTIER `
    + 'block, fewer than the 6 standing after retired its spec to claude/specs/resolved/. That '
    + 'block is where a spec keeps its own record of what is left and who owns each row; if one lost '
    + 'its block, the goal state now lives nowhere. If a spec was genuinely retired, lower this floor '
    + 'in the same change and say why.');

assert.ok(liveRows > 0,
    'no live frontier rows were found in any spec, so the citation check above passed without checking '
    + 'anything. A row is live unless its Item cell is struck through or parenthesised as superseded; '
    + 'if the parser stopped recognising rows, fix it rather than accepting the green.');

assert.ok(citations > 0,
    'no cited paths were found in any live frontier row, so the citation check above passed without '
    + 'checking anything. Frontier rows name the files they are about on purpose - that naming is what '
    + 'lets the next reader check rather than trust.');

// The acceptance check has the same three ways of passing on an empty set, and
// one more of its own: the parser looks for a `**Milestone acceptance**`
// heading, so a block that renamed that heading would drop out of the check
// while still carrying tests.
assert.ok(withAcceptance >= 5,
    `only ${withAcceptance} of ${withFrontier.length} frontier blocks carry a Milestone acceptance list, `
    + 'fewer than the 5 standing when this floor was written (the four wallet publishing lanes plus the '
    + 'release rails). Those tests are what make "am I done" a measurement rather than an opinion, so a '
    + 'block that lost its list has no completion criterion at all. If a spec legitimately retired its '
    + 'list, lower this floor in the same change and say why.');

assert.ok(acceptanceCitations > 0,
    'no cited paths were found in any milestone acceptance test, so the acceptance check above passed '
    + 'without checking anything. These tests are written as commands the operator pastes, and the paths '
    + 'live INSIDE the backticks rather than alone in them; if the reader stopped matching, fix it '
    + 'rather than accepting the green.');

// This floor is the one that cost a falsification to get right, and the note
// is here so nobody re-weakens it. Flooring on acceptanceCitations above is
// NOT enough: that count includes paths backticked on their own, which the
// inline regex has always caught, and one sibling spec writes two of its
// acceptance paths that way. So deleting the in-command reader entirely - the
// only thing that can see a path inside `node <script> <args>`, and the only
// reason this gate catches anything in THIS spec - left the suite green.
// Flooring on the in-command subset specifically is what makes the mechanism
// undeletable-in-silence.
assert.ok(inCommandCitations > 0,
    'no acceptance-test path was found INSIDE a backticked command, so the reader that exists for '
    + 'exactly that shape is no longer matching anything and the acceptance check is running on the '
    + 'inline citations alone. An acceptance test is written as a command the operator pastes '
    + '(`node packages/.../audit.mjs <zip>`), so that shape is the normal one and its absence means the '
    + 'extractor broke, not that the specs changed style.');

const byOwner = [...owners.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([owner, n]) => `${owner}:${n}`)
    .join(', ');

console.log(`OK: spec frontier-citations smoke (${withFrontier.length} specs with a frontier block, `
    + `${liveRows} live rows, ${citations} cited paths resolved across checkouts - ${byOwner}; `
    + `${withAcceptance} blocks with acceptance tests, ${acceptanceLines} tests, `
    + `${acceptanceCitations} cited path(s) in them; `
    + `${elided} elided or placeholder path(s) unchecked)`);
