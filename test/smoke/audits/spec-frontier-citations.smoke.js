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
    citationsIn, frontierRowsOf, listSpecs, resolveCitation, skipUnlessSpecs, SPECS_DIR,
} from '../_spec-frontier.js';

skipUnlessSpecs('spec frontier-citations smoke');

const specs = listSpecs();
const withFrontier = [];
const dead = [];
let liveRows = 0;
let citations = 0;
let elided = 0;
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
}

assert.equal(dead.length, 0,
    `live frontier rows cite paths that do not exist in any checkout:\n  ${dead.join('\n  ')}\n`
    + 'The frontier is what a later stage, or the operator, reads to find out what is left, so a live '
    + 'row pointing at a deleted file quietly costs a stage. Repoint it at wherever the artifact went '
    + '(the  migration moved most of them to xchain-documentation/components/wallet/). If the '
    + 'row is narrating something that is SUPPOSED to be gone, that is prose rather than a pointer: '
    + 'drop the backticks and say it is deleted, the way the superseded rows do.');

// --- The three ways this gate could pass without checking anything ------
//
// Each of these is a real regression path, not defensive noise. A rename of
// the delimiter, a scrub of the tables, or a tightening of the citation regex
// would each leave the assertion above passing on an empty set, and a gate
// that passes vacuously is indistinguishable from one that was deleted.

assert.ok(withFrontier.length >= 7,
    `only ${withFrontier.length} of ${specs.length} specs in ${SPECS_DIR} carry a BUILD-SPEC:FRONTIER `
    + 'block, fewer than the 7 standing when this gate was written. That block is where a spec keeps '
    + 'its own record of what is left and who owns each row; if one lost its block, the goal state now '
    + 'lives nowhere. If a spec was genuinely retired, lower this floor in the same change and say why.');

assert.ok(liveRows > 0,
    'no live frontier rows were found in any spec, so the citation check above passed without checking '
    + 'anything. A row is live unless its Item cell is struck through or parenthesised as superseded; '
    + 'if the parser stopped recognising rows, fix it rather than accepting the green.');

assert.ok(citations > 0,
    'no cited paths were found in any live frontier row, so the citation check above passed without '
    + 'checking anything. Frontier rows name the files they are about on purpose - that naming is what '
    + 'lets the next reader check rather than trust.');

const byOwner = [...owners.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([owner, n]) => `${owner}:${n}`)
    .join(', ');

console.log(`OK: spec frontier-citations smoke (${withFrontier.length} specs with a frontier block, `
    + `${liveRows} live rows, ${citations} cited paths resolved across checkouts - ${byOwner}; `
    + `${elided} elided or placeholder path(s) unchecked)`);
