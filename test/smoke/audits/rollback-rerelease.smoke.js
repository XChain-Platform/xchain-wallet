// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  §4, stage S19: `tools/release/rollback-rerelease.sh`.
//
// Spec §4 says there is no rollback lever on the Chrome Web Store, so the
// substitute must be "prepared before launch so it is not invented
// mid-incident". It was prepared at S4 on 2026-07-31 and then never run
// and never tested - which is the same shape as the S18 finding one door
// over, where the never-waived post-publish check turned out to have
// never been green because it had never been executed. A recipe nobody
// has driven is a document, not a lever.
//
// The first run, on 2026-08-02, found two real defects, and both are
// pinned below:
//
//   1. The script derived its own list of version-bearing files with a
//      `find -maxdepth 3 -name package.json` sweep. That is a second
//      derivation of a rule the repo already states (, enforced
//      by version-lockstep.smoke.js) and it disagreed with that rule in
//      BOTH directions: it swept in `test/e2e/package.json`, which is an
//      explicit documented exemption, and it omitted
//      `packages/extension/manifest.json`, which is the only version the
//      Chrome Web Store ever reads. The printed recipe then told the
//      operator to "bump every version-bearing file listed above".
//
//   2. The version floor came from the repo alone. The script's own
//      recipe step 2 tells the operator to check out the good tag in a
//      throwaway clone, where every version file reads BELOW the bad
//      version the store already served, so the floor would approve
//      exactly the version the store refuses. The floor now also reads
//      `publish-log.md`, the record of what has actually been published.
//
// The runtime half below drives the script against throwaway git repos,
// because every check in it exists to refuse something and a gate is
// only real if something has watched it refuse. Exit codes alone are not
// enough: a gate that refuses for the wrong reason still "refuses", so
// each negative case asserts the diagnosis too.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const SCRIPT = 'tools/release/rollback-rerelease.sh';
assert.ok(existsSync(join(root, SCRIPT)), `${SCRIPT} exists`);

// ---------------------------------------------------------------- shape

const src = read(SCRIPT);
assert.ok(/^#!\/usr\/bin\/env bash/.test(src), 'rollback-rerelease.sh has a bash shebang');
assert.ok(/set -euo pipefail/.test(src), 'rollback-rerelease.sh has the strict-mode guard');

// The header is the thing an operator reads at 3am before touching this.
// These three sentences are why the script exists and why it is not the
// fast path; losing any of them turns it back into a lever people reach
// for expecting speed.
assert.ok(/THERE IS NO ROLLBACK/.test(src),
    'the header still states plainly that no rollback lever exists');
assert.ok(/INCIDENT-RUNBOOK\.md/.test(src),
    'the header still points at the real emergency levers, which this recipe is not');
assert.ok(/does NOT\s*#?\s*commit, tag, push, sign, or publish/.test(src),
    'the header still states that this script takes no consequential action');

// The floor must be derived from the publish log through the monitor's
// own parser. A second regex here would be the same defect this stage
// exists to fix, one file over.
assert.ok(/parsePublishLog/.test(src),
    'the floor reads publish-log.md through parsePublishLog, not a second regex');
assert.ok(!/find\s+"\$REPO_ROOT"\s+-maxdepth\s+3\s+-name\s+package\.json/.test(src),
    'the hand-rolled find sweep for version-bearing files is gone (it disagreed with  both ways)');

// ------------------------------------------------------- runtime harness

const sh = (args, opts = {}) => spawnSync('bash', args, { encoding: 'utf8', ...opts });
const git = (cwd, args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

const work = mkdtempSync(join(tmpdir(), 'xc-rollback-'));
let failures = 0;
const check = (label, cond, detail) => {
    if (cond) return;
    failures += 1;
    console.error(`FAIL ${label}${detail ? `\n     ${detail.trim().split('\n').join('\n     ')}` : ''}`);
};

const SCAFFOLD_LOG = `# Chrome Web Store publish log

## Log

| version | zip sha256 | item | operator | date |
|---|---|---|---|---|
| 0.0.0-EXAMPLE | \`${'0'.repeat(64)}\` | main | EXAMPLE-operator (not a real entry) | 2026-01-01 |
`;

const logWithRow = (version) => `# Chrome Web Store publish log

## Log

| version | zip sha256 | item | operator | date |
|---|---|---|---|---|
| ${version} | \`${'a'.repeat(64)}\` | main | smoke-operator | 2026-01-02 |
`;

try {
    // A fixture repo shaped like the wallet: a root version, packages
    // under packages/, the store-facing manifest, the user-facing
    // buildInfo constant, and - deliberately - the exempt test/e2e
    // harness on its own version train, because that is the trap the
    // original sweep fell into.
    const repo = join(work, 'repo');
    const write = (rel, body) => {
        mkdirSync(join(repo, dirname(rel)), { recursive: true });
        writeFileSync(join(repo, rel), body);
    };

    write('package.json', JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2));
    for (const pkg of ['core', 'extension', 'web']) {
        write(`packages/${pkg}/package.json`, JSON.stringify({ name: pkg, version: '1.0.0' }, null, 2));
    }
    write('packages/extension/manifest.json',
        JSON.stringify({ manifest_version: 3, name: 'Fixture', version: '1.0.0' }, null, 2));
    write('packages/core/src/buildInfo.js', "export const WALLET_VERSION = '1.0.0';\n");
    write('test/e2e/package.json', JSON.stringify({ name: 'e2e', version: '0.1.0' }, null, 2));
    write('packages/extension/docs/publish-log.md', SCAFFOLD_LOG);

    mkdirSync(join(repo, 'tools', 'release'), { recursive: true });
    for (const f of ['rollback-rerelease.sh', 'store-version-monitor.mjs']) {
        cpSync(join(root, 'tools/release', f), join(repo, 'tools/release', f));
    }

    git(repo, ['init', '-q', '.']);
    git(repo, ['add', '-A']);
    git(repo, ['-c', 'user.email=smoke@test.invalid', '-c', 'user.name=smoke',
        'commit', '-qm', 'init']);
    // `tag.gpgsign=false` because this machine sets it globally :
    // without it a lightweight `git tag` becomes a signed annotated one,
    // fails with "no tag message?", and this smoke goes red on the box
    // that does the real releases while staying green in a clean
    // container. What is under test is the script, never the fixture tag.
    git(repo, ['-c', 'tag.gpgsign=false', 'tag', 'v1.0.0']);
    check('fixture repo has a tagged commit',
        /^[0-9a-f]{40}$/.test(git(repo, ['rev-parse', 'v1.0.0']).stdout.trim()));

    const RB = join(repo, 'tools/release/rollback-rerelease.sh');
    const run = (...args) => sh([RB, '--repo', repo, ...args]);

    // --- argument handling -------------------------------------------
    const noTag = run();
    check('refuses to run without --good-tag', noTag.status === 2, noTag.stderr);
    check('names the missing argument', /--good-tag <vX\.Y\.Z> is required/.test(noTag.stderr), noTag.stderr);

    const badTag = run('--good-tag', 'v9.9.9', '--new-version', '2.0.0');
    check('refuses a tag that does not exist', badTag.status === 1, badTag.stderr);
    check('names the tag it could not find',
        /tag 'v9\.9\.9' does not exist/.test(badTag.stderr), badTag.stderr);

    const help = sh([RB, '--help']);
    check('--help exits 0', help.status === 0, help.stderr);
    check('--help prints the "there is no rollback" header',
        /THERE IS NO ROLLBACK/.test(help.stdout), help.stdout.slice(0, 400));

    // --- the version-bearing set (defect 1) ---------------------------
    const suggest = run('--good-tag', 'v1.0.0');
    check('exits 2 rather than picking a version for the operator', suggest.status === 2, suggest.stderr);
    check('suggests the floor patch+1', /Suggested \(floor patch\+1\): 1\.0\.1/.test(suggest.stderr), suggest.stderr);

    const listed = [...suggest.stderr.matchAll(/^\s{4}(\S.*?)=(\S+)$/gm)].map((m) => m[1]);
    check('the set includes the store-facing manifest.json',
        listed.includes('packages/extension/manifest.json'),
        `listed: ${listed.join(', ')}`);
    check('the set excludes the exempt test/e2e harness',
        !listed.some((p) => p.startsWith('test/e2e')),
        `listed: ${listed.join(', ')}`);
    check('the set includes the root package.json', listed.includes('package.json'), listed.join(', '));
    check('the set includes every package under packages/',
        ['core', 'extension', 'web'].every((p) => listed.includes(`packages/${p}/package.json`)),
        listed.join(', '));
    check('the set includes the user-facing WALLET_VERSION',
        listed.some((p) => p.includes('buildInfo.js')), listed.join(', '));

    // The exemption has to be a live trap, not a vacuous one: if the
    // fixture ever stops carrying test/e2e, the assertion above passes
    // while testing nothing.
    check('the fixture actually contains the exempt file, so the exclusion is meaningful',
        existsSync(join(repo, 'test/e2e/package.json')));

    // --- the ordering rules on the version itself ---------------------
    const ok = run('--good-tag', 'v1.0.0', '--new-version', '1.1.0');
    check('accepts a strictly higher version', ok.status === 0, ok.stderr);
    check('reports preconditions ok', /preconditions ok/.test(ok.stderr), ok.stderr);

    // The printed recipe must not send the operator back to bumping the
    // exempt harness, nor let them drop the one file the store reads.
    // Asserted on THIS run and not on the suggestion run above, because
    // the recipe is only printed once a version has been chosen.
    check('the recipe warns off the exempt harness by name',
        /test\/e2e carries its own version by decision/.test(ok.stderr), ok.stderr);
    check('the recipe says why manifest.json specifically cannot be left behind',
        /manifest\.json is in the list/.test(ok.stderr)
            && /the Chrome Web Store ever reads/.test(ok.stderr), ok.stderr);

    const equal = run('--good-tag', 'v1.0.0', '--new-version', '1.0.0');
    check('refuses a version equal to the floor', equal.status === 1, equal.stderr);
    const lower = run('--good-tag', 'v1.0.0', '--new-version', '0.9.0');
    check('refuses a version below the floor', lower.status === 1, lower.stderr);
    check('explains the refusal in the store\'s terms',
        /Chrome Web Store refuses a version it has already served/.test(lower.stderr), lower.stderr);

    // --- the store floor (defect 2) -----------------------------------
    //
    // This is the rollback scenario itself. Every version file in the repo
    // reads 1.0.0, because step 2 of the recipe says to check out the good
    // tag; meanwhile the store has been given 2.0.0 (the bad release being
    // rolled back). A floor computed from the repo alone says 1.0.1 is
    // fine. The store refuses it.
    writeFileSync(join(repo, 'packages/extension/docs/publish-log.md'), logWithRow('2.0.0'));

    const behindStore = run('--good-tag', 'v1.0.0', '--new-version', '1.0.1');
    check('refuses a version the store has already passed, even though the repo has not',
        behindStore.status === 1, behindStore.stderr);
    check('names publish-log.md as the source of the higher floor',
        /publish-log\.md \(the store is AHEAD of this checkout\)/.test(behindStore.stderr),
        behindStore.stderr);
    check('the reported floor is the store\'s, not the repo\'s',
        /floor to beat: 2\.0\.0/.test(behindStore.stderr), behindStore.stderr);

    const aboveStore = run('--good-tag', 'v1.0.0', '--new-version', '2.0.1');
    check('accepts a version above the store floor', aboveStore.status === 0, aboveStore.stderr);
    check('shows the operator what the store has actually been given',
        /published versions \(publish-log\.md\): 2\.0\.0/.test(aboveStore.stderr), aboveStore.stderr);

    // The scaffold's worked EXAMPLE row must not be mistaken for a publish
    // (parsePublishLog drops it), and "no rows" must be said out loud
    // rather than passing as silence - after the first publish, an empty
    // log is itself the rogue-publish signal spec §2 describes.
    writeFileSync(join(repo, 'packages/extension/docs/publish-log.md'), SCAFFOLD_LOG);
    const scaffold = run('--good-tag', 'v1.0.0', '--new-version', '1.0.1');
    check('the EXAMPLE row is not counted as a publish', scaffold.status === 0, scaffold.stderr);
    check('an empty log is stated, not passed over in silence',
        /published versions: NONE logged/.test(scaffold.stderr), scaffold.stderr);
    check('and it says what an empty log means after the first publish',
        /something published without going through/.test(scaffold.stderr), scaffold.stderr);

    // A missing log is a DIFFERENT state from an empty one, and the
    // difference is the whole S5/S13 lesson: "could not tell" must never
    // read as "all clear".
    rmSync(join(repo, 'packages/extension/docs/publish-log.md'));
    const noLog = run('--good-tag', 'v1.0.0', '--new-version', '1.0.1');
    check('a missing publish log is reported as could-not-tell, not as clean',
        /published versions: COULD NOT TELL/.test(noLog.stderr), noLog.stderr);
    writeFileSync(join(repo, 'packages/extension/docs/publish-log.md'), SCAFFOLD_LOG);

    // A parse that DIES must not read as a parse that found nothing. The
    // first cut of this had exactly that bug: the node call was
    // `2>/dev/null || true`, and because the monitor's own main-guard
    // fired on the import, it exited 2 and returned an empty string,
    // which the script then announced as "NONE logged" - a confident
    // wrong answer about whether the store has been published to. It is
    // reproduced here by breaking the parser the script depends on.
    const monitorPath = join(repo, 'tools/release/store-version-monitor.mjs');
    const monitorSrc = readFileSync(monitorPath, 'utf8');
    writeFileSync(monitorPath, 'export function parsePublishLog() { throw new Error("boom"); }\n');
    const brokenParse = run('--good-tag', 'v1.0.0', '--new-version', '1.0.1');
    check('a failed parse is could-not-tell, never "no rows logged"',
        /published versions: COULD NOT TELL - parsing/.test(brokenParse.stderr), brokenParse.stderr);
    check('a failed parse does not claim an empty log',
        !/published versions: NONE logged/.test(brokenParse.stderr), brokenParse.stderr);
    check('a failed parse says out loud that it is not an all-clear',
        /NOT an all-clear/.test(brokenParse.stderr), brokenParse.stderr);
    writeFileSync(monitorPath, monitorSrc);

    // --- the script must not touch anything ---------------------------
    //
    // Its header promises every check is a read-only git query. An
    // incident is the worst possible time to discover otherwise.
    //
    // Deliberately NOT preceded by a `git add -A && commit` to tidy the
    // fixture: mutation testing showed that doing so LAUNDERS the very
    // thing being looked for. A side effect from any earlier run in this
    // file gets committed by that tidy-up and the tree then reads clean,
    // so the check passed against a script that really did write to the
    // repo. Everything the smoke itself wrote above has been restored
    // byte-for-byte, so the tree is already clean here on its own.
    run('--good-tag', 'v1.0.0', '--new-version', '3.0.0');
    const dirty = git(repo, ['status', '--porcelain']).stdout.trim();
    check('the script leaves the working tree untouched', dirty === '', dirty);

    // --- cross-check against the REAL repo ----------------------------
    //
    // The fixture proves the script obeys the rule; this proves the rule
    // it obeys is still this repo's rule. Derived here the same way
    // version-lockstep.smoke.js derives it (from the filesystem, so a
    // package added tomorrow is in scope the moment it exists), and
    // compared in both directions: a member the script misses is a file
    // the operator would fail to bump, and a non-member it invents is a
    // file the operator would bump wrongly.
    const realRun = sh([join(root, SCRIPT), '--good-tag', 'v0.334.0']);
    if (realRun.status === 1 && /does not exist/.test(realRun.stderr)) {
        console.log('  (skipped the real-repo cross-check: tag v0.334.0 is not in this checkout)');
    } else {
        const realListed = [...realRun.stderr.matchAll(/^\s{4}(\S.*?)=(\S+)$/gm)]
            .map((m) => m[1].replace(/ \(WALLET_VERSION\)$/, ''));
        const expected = ['package.json'];
        for (const name of readdirSync(join(root, 'packages')).sort()) {
            if (existsSync(join(root, 'packages', name, 'package.json'))) {
                expected.push(`packages/${name}/package.json`);
            }
        }
        expected.push('packages/extension/manifest.json', 'packages/core/src/buildInfo.js');

        const missing = expected.filter((p) => !realListed.includes(p));
        const extra = realListed.filter((p) => !expected.includes(p));
        check('the script\'s version-bearing set matches \'s, with nothing missing',
            missing.length === 0,
            `missing: ${missing.join(', ')}`);
        check('the script\'s version-bearing set matches \'s, with nothing invented',
            extra.length === 0,
            `extra: ${extra.join(', ')} - the operator would be told to bump these`);
        check('test/e2e is present in this repo and still excluded, so the exemption is live',
            existsSync(join(root, 'test/e2e/package.json'))
                && !realListed.some((p) => p.startsWith('test/e2e')),
            realListed.join(', '));
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed in rollback-rerelease.smoke.js`);
    process.exit(1);
}

console.log('OK: rollback-rerelease smoke ( §4 / S19: the recipe driven end to end - '
    + 'version-bearing set pinned to  in both directions, the store floor read from '
    + 'publish-log.md, and every refusal watched refusing)');
