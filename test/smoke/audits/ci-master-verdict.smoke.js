// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every master commit must be able to REACH a verdict.
//
// The release gate (tools/release/verify-validated-commit.mjs,  §6 step 1)
// requires a run of ci.yml on the EXACT tag commit that is both `completed` and
// `success`. It has no skip switch, by design. A cancelled run is therefore not
// a neutral outcome: it leaves that commit permanently unreleasable, because a
// tag names bytes and the bytes cannot be re-validated later under a new run.
//
// ci.yml used to carry a blanket `cancel-in-progress: true`, which applies to
// master pushes exactly as it applies to pull requests. Several sessions push to
// this repo, so pushes routinely arrive faster than CI completes and each one
// killed the previous commit's verdict. Measured 2026-08-03 across the last 40
// master runs: 30 cancelled, 9 failed, 1 success. Finding a green commit to tag
// had become luck rather than process, and  spent days reading as "CI is
// red" when a large part of it was "CI was never allowed to finish".
//
// Cancellation is still correct off master, where only the newest push matters
// and runner minutes are the only thing at stake.
//
// This gate is deliberately about the POLICY, not about any one run's colour.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workflows = join(here, '..', '..', '..', '.github', 'workflows');
const ci = readFileSync(join(workflows, 'ci.yml'), 'utf8');

// Read the concurrency block rather than grepping the whole file, so an
// unrelated `cancel-in-progress` elsewhere can never satisfy or break this.
const block = ci.match(/^concurrency:\n((?:[ \t]+.*\n|[ \t]*\n)*)/m);

assert.ok(block,
    'ci.yml has no top-level `concurrency:` block. It needs one: without a concurrency group, '
    + 'every push to a branch runs in parallel with its predecessors and the runner bill grows '
    + 'without bound. The fix is to add the group back with master exempted from cancellation, '
    + 'not to leave it absent.');

// Strip comments before matching. The block is heavily commented precisely
// because this setting keeps being got wrong, and the first cut of this gate
// then matched the word `cancel-in-progress:` inside its own explanatory
// comment instead of the setting, reporting the prose as the value.
const body = block[1]
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

const cancel = body.match(/cancel-in-progress:\s*(.+)/);

assert.ok(cancel,
    'ci.yml\'s concurrency block no longer sets `cancel-in-progress`. GitHub defaults it to false, '
    + 'which is safe for the release gate but wasteful on pull requests. Set it explicitly so the '
    + 'master-versus-branch distinction is stated rather than inherited.');

const value = cancel[1].trim();

assert.notEqual(value, 'true',
    'ci.yml sets `cancel-in-progress: true`, which cancels superseded runs ON MASTER TOO. That is '
    + 'the exact configuration that made 30 of 40 master runs cancel and left  with no '
    + 'releasable commit: the release gate requires a COMPLETED, SUCCESSFUL ci.yml run on the tag '
    + 'commit, and a cancelled run can never become one. Gate the flag on the ref instead:\n'
    + "  cancel-in-progress: ${{ github.ref != 'refs/heads/master' }}");

// The flag must be conditional on the ref, and the condition must actually
// exempt master. Checking the shape rather than one exact string, so an
// equivalent spelling (a different default branch name, an `inputs`-driven
// expression) is free to differ without failing on correct writing.
assert.match(value, /\$\{\{.*github\.ref.*\}\}/,
    `ci.yml sets \`cancel-in-progress: ${value}\`, which is neither \`true\` nor an expression on `
    + '`github.ref`. This flag has to distinguish master (never cancel, so every commit reaches a '
    + 'verdict the release gate can read) from everything else (cancel freely). A constant cannot.');

assert.match(value, /refs\/heads\/master/,
    `ci.yml's \`cancel-in-progress\` expression (${value}) does not mention refs/heads/master, so `
    + 'nothing in it exempts the branch the release gate reads. If the default branch was renamed, '
    + 'update this gate in the same change.');

// Falsifiable in the useful direction: the expression must evaluate FALSE for
// master and TRUE for a pull request. Evaluated here rather than trusted,
// because the whole defect class this repo keeps finding is a rule asserted
// with nothing deriving it.
const evaluate = (ref) => {
    const inner = value.replace(/^\$\{\{/, '').replace(/\}\}$/, '').trim();
    const m = inner.match(/^github\.ref\s*(!=|==)\s*'([^']+)'$/);
    assert.ok(m,
        `the \`cancel-in-progress\` expression (${inner}) is no longer a simple github.ref `
        + 'comparison, so this gate can no longer evaluate it. Extend the evaluator in the same '
        + 'change rather than deleting the assertions below: they are what proves master is exempt.');
    return m[1] === '!=' ? ref !== m[2] : ref === m[2];
};

assert.equal(evaluate('refs/heads/master'), false,
    'the `cancel-in-progress` expression evaluates TRUE on refs/heads/master, so master runs would '
    + 'still be cancelled and the release gate would still have no completed run to read.');

assert.equal(evaluate('refs/pull/42/merge'), true,
    'the `cancel-in-progress` expression evaluates FALSE for pull requests, so superseded PR runs '
    + 'would pile up. Master is the exemption; everything else should still cancel.');

// The group must be per-COMMIT on master, not merely per-ref.
//
// This assertion exists because the first version of this gate passed on a
// configuration that was measured failing hours later. `cancel-in-progress:
// false` protects a RUNNING job; GitHub separately keeps only one PENDING run
// per concurrency group, and a newer push evicts a queued one regardless of
// that flag. Run 30864080980 on c4008051 was evicted while queued, 0 jobs ever
// started, by a later push that already carried the flag fix.
//
// Grouping per commit removes the contention instead of arbitrating it. There
// is then no such thing as two master runs in one group, so nothing can evict
// anything and every commit reaches a verdict.
const group = body.match(/group:\s*(.+)/);

assert.ok(group,
    'ci.yml\'s concurrency block sets no `group`. Without one the block does nothing at all.');

const groupValue = group[1].trim();

assert.match(groupValue, /github\.sha/,
    `ci.yml's concurrency group (${groupValue}) does not vary by github.sha, so every master commit `
    + 'shares one group and a newer push evicts whichever run is still QUEUED. `cancel-in-progress: '
    + 'false` does not prevent that: it only protects a run that has already started. A commit whose '
    + 'run was evicted while queued can never satisfy the release gate. Group per commit on master:\n'
    + "  group: ci-${{ github.ref }}-${{ github.ref == 'refs/heads/master' && github.sha || 'ref' }}");

assert.match(groupValue, /refs\/heads\/master/,
    `ci.yml's concurrency group (${groupValue}) uses github.sha unconditionally, which would give `
    + 'every pull-request push its own group too and defeat superseding entirely. The sha must be '
    + 'conditional on master.');

// A push to master must still be a trigger, or the gate above guards nothing.
assert.match(ci, /on:\n(?:.*\n)*?\s*push:\n\s*branches:\s*\[\s*master\s*\]/,
    'ci.yml no longer runs on pushes to master. The release gate reads a ci.yml run on the tag '
    + 'commit, and tags are cut from master, so without this trigger no commit is ever releasable.');

console.log('OK: ci master-verdict smoke (concurrency exempts refs/heads/master from '
    + 'cancel-in-progress, evaluated both ways; push-to-master trigger intact)');
