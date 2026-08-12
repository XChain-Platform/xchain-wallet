// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: the §6 release record is a precondition, not a
// convention.
//
// WHAT WENT WRONG. §6 says the per-release record is instantiated from
// `claude/reports/wallet-releases/TEMPLATE.md` at the start of a release
// and closed by step 8. Nothing created it and nothing asked for it, so
// v0.334.0 - the first release this project ever attempted - was tagged,
// built green and left half-finished while that directory still held
// only TEMPLATE.md. For a day the only account of it lived in GitHub's
// run history, and the record was written retroactively from the run's
// own summary job, which is a reconstruction rather than an account: it
// can only hold what a machine happened to log.
//
// WHAT THIS ASSERTS. The two gates that make skipping it impossible, and
// the tool that makes opening it a one-liner so there is no incentive to:
//
//   step 1  this smoke runs inside `pnpm ci`, inside `pnpm release:gate`,
//           and demands a record for the version the working tree
//           DECLARES. The bump commit is what step 2 pins the tag to, so
//           a release cannot acquire a validated commit before its record
//           exists.
//   step 5  publish.sh refuses a production publish whose tag has no
//           instantiated record, beside the rehearsal gate it already
//           runs, with no skip switch.
//
// Every negative case below is driven against throwaway directories and
// throwaway git repos rather than asserted from source text, because a
// gate is only real once something has watched it refuse - and asserting
// the exit code alone is not enough, since a gate that refuses for the
// wrong reason still "refuses". Each case checks the diagnosis too.
//
// THE REPO BOUNDARY IS HONEST HERE. The records live in the PLATFORM
// repo one level above this one, which an isolated single-repo CI
// checkout does not have. The last section therefore SKIPS loudly when
// the records directory is absent, exactly as the docs-parity smokes
// have. What that costs: GitHub CI cannot enforce the
// step-1 half. What it does not cost: the step-5 half, because
// publish.sh runs on the release machine, which is a full monorepo tree.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');                       // xchain-wallet
const read = (p) => readFileSync(join(root, p), 'utf8');

const TOOL = 'tools/release/release-record.mjs';
const TOOL_ABS = join(root, TOOL);
assert.ok(existsSync(TOOL_ABS), `${TOOL} exists`);

const {
    RECORDS_DIR, TEMPLATE_PATH, recordsAvailable, EXIT_UNAVAILABLE,
} = await import(TOOL_ABS);

// ---------------------------------------------------------------- shape

// publish.sh is the half that runs where the platform repo always
// exists, so it is the half that must never soften into a warning.
const publish = read('tools/release/publish.sh');
assert.ok(/release-record\.mjs" assert --tag/.test(publish),
    'publish.sh runs the §6 record gate through release-record.mjs assert');
assert.ok(/--release-record\)/.test(publish),
    'publish.sh accepts --release-record for a record kept off the default path');
assert.ok(!/SKIP_RELEASE_RECORD|--no-release-record|--skip-record/.test(publish),
    'publish.sh has no switch that waives the record gate');

// The gate must sit inside the production-only branch. Outside it, a
// staging publish - which is step ONE of the rehearsal, run before the
// record has anything in it worth reading - would be refused too, and a
// gate that fires on the wrong step is a gate people route around.
const prodBlock = publish.slice(publish.indexOf('if [[ "$STAGING" -eq 0 ]]; then'));
assert.ok(prodBlock.indexOf('release-record.mjs') > -1,
    'the record gate is inside the production-only block, so --staging is not refused by it');

// It must also run BEFORE verify.sh, which hashes every artifact: an
// artifact set that is not allowed out should not cost minutes first.
assert.ok(publish.indexOf('release-record.mjs') < publish.indexOf('bash "$HERE/verify.sh"'),
    'the record gate runs before verify.sh hashes the artifacts');

const readme = read('tools/release/README.md');
assert.ok(/release-record\.mjs/.test(readme),
    'tools/release/README.md documents release-record.mjs');

// -------------------------------------------------------- runtime harness

const runTool = (args, recordsDir) => spawnSync(process.execPath, [TOOL_ABS, ...args], {
    encoding: 'utf8',
    cwd: root,
    env: { ...process.env, XCHAIN_WALLET_RELEASE_RECORDS: recordsDir },
});

const scratch = mkdtempSync(join(tmpdir(), 'xc1099-'));
const cleanups = [() => rmSync(scratch, { recursive: true, force: true })];

// `tag.gpgsign = true` is set globally on the release machine, so a bare
// `git tag` in a fixture repo fails for want of a message and creates
// nothing. Neutralised per invocation rather than trusted to
// ambient config.
const GIT_CLEAN = [
    '-c', 'user.email=smoke@example.invalid',
    '-c', 'user.name=Smoke',
    '-c', 'commit.gpgsign=false',
    '-c', 'tag.gpgsign=false',
];
const git = (cwd, args) => spawnSync('git', ['-C', cwd, ...GIT_CLEAN, ...args], { encoding: 'utf8' });

/** A records directory holding only TEMPLATE.md, like the real one did. */
function makeRecordsDir(name) {
    const dir = join(scratch, name);
    mkdirSync(dir, { recursive: true });
    cpSync(TEMPLATE_PATH_OR_FIXTURE, join(dir, 'TEMPLATE.md'));
    return dir;
}

// The template itself lives in the platform repo. When that is absent
// the runtime half still has to run, so fall back to a fixture that
// carries the shapes the tool substitutes into.
const FIXTURE_TEMPLATE = `# XChain Wallet release record - vX.Y.Z

Copy this file to \`vX.Y.Z.md\` at the start of a release and fill it in
as you go. It is the §6 checklist instantiated for one release: the
facts a later reader needs when something goes wrong, in the order they
become known.

**Item:**

---

## Identity

**Version:** X.Y.Z
**Tag:** vX.Y.Z
**Channel:** stable | beta
**Store integers:** run the script.
**Release manager:**
**Opened:**
**Closed:**
`;
const fixtureTemplatePath = join(scratch, 'TEMPLATE.fixture.md');
writeFileSync(fixtureTemplatePath, FIXTURE_TEMPLATE);
const TEMPLATE_PATH_OR_FIXTURE = existsSync(TEMPLATE_PATH) ? TEMPLATE_PATH : fixtureTemplatePath;

/** A throwaway git repo declaring `version`, optionally tagged. */
function makeRepo(name, { version, tags = [] }) {
    const dir = join(scratch, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'w', version }, null, 2)}\n`);
    git(dir, ['init', '-q', '-b', 'master']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', `v${version}`]);
    for (const tag of tags) git(dir, ['tag', '-a', '-m', tag, tag]);
    return dir;
}

try {
    // ------------------------------------------------- assert: no record
    const empty = makeRecordsDir('empty');
    let r = runTool(['assert', '--tag', 'v0.400.0'], empty);
    assert.equal(r.status, 1, 'assert refuses a tag with no record');
    assert.ok(r.stderr.includes(join(empty, 'v0.400.0.md')),
        'the refusal names the path where the record belongs');
    assert.ok(/release-record\.mjs open --tag v0\.400\.0/.test(r.stderr),
        'the refusal says how to open it, not just that it is missing');
    assert.ok(/no skip switch/.test(r.stderr),
        'the refusal states plainly that there is no way around it');

    // --------------------------------- assert: an untouched template copy
    //
    // The likeliest way to defeat a "file exists" gate is `cp TEMPLATE.md
    // vX.Y.Z.md`, so that copy is refused by name.
    const copied = makeRecordsDir('copied');
    cpSync(join(copied, 'TEMPLATE.md'), join(copied, 'v0.400.0.md'));
    r = runTool(['assert', '--tag', 'v0.400.0'], copied);
    assert.equal(r.status, 1, 'assert refuses a byte-for-byte copy of the template');
    assert.ok(/byte-for-byte copy of TEMPLATE\.md/.test(r.stderr),
        'the refusal diagnoses the copy rather than reporting a generic failure');

    // --------------------------- assert: a half-edited copy is still refused
    const halfEdited = makeRecordsDir('half');
    writeFileSync(join(halfEdited, 'v0.400.0.md'),
        readFileSync(join(halfEdited, 'TEMPLATE.md'), 'utf8').replace('**Version:** X.Y.Z', '**Version:** 0.400.0'));
    r = runTool(['assert', '--tag', 'v0.400.0'], halfEdited);
    assert.equal(r.status, 1, 'a record still carrying the template instructions is refused');
    assert.ok(/copy this file/i.test(r.stderr),
        'the refusal names the leftover instructions');

    // ----------------------------------------------------- open, then assert
    const opened = makeRecordsDir('opened');
    r = runTool(['open', '--tag', 'v0.400.0', '--manager', 'Smoke'], opened);
    assert.equal(r.status, 0, `open instantiates the record (${r.stderr})`);
    const openedPath = join(opened, 'v0.400.0.md');
    assert.ok(existsSync(openedPath), 'open wrote the record');
    const body = readFileSync(openedPath, 'utf8');
    assert.ok(body.startsWith('# XChain Wallet release record - v0.400.0'),
        'the instantiated record names the release in its title');
    assert.ok(/^\*\*Version:\*\* 0\.400\.0\s*$/m.test(body), 'the Version field is filled');
    assert.ok(/^\*\*Tag:\*\* v0\.400\.0\s*$/m.test(body), 'the Tag field is filled');
    assert.ok(/^\*\*Opened:\*\* \d{4}-\d{2}-\d{2}/m.test(body), 'the Opened field is dated');
    assert.ok(/^\*\*Release manager:\*\* Smoke/m.test(body), 'the release manager is recorded');
    assert.ok(!/Copy this file to /.test(body),
        "the template's own copy instructions are dropped from the instantiated record");
    // The title's blank line survives. `\s*$` in the substitution ate it
    // once, welding the heading onto the next paragraph.
    assert.ok(/^# XChain Wallet release record - v0\.400\.0\n\n/.test(body),
        'the blank line after the title survives instantiation');

    r = runTool(['assert', '--tag', 'v0.400.0'], opened);
    assert.equal(r.status, 0, `assert accepts a record that open wrote (${r.stderr})`);
    assert.ok(/\(open\)/.test(r.stdout), 'an unclosed record reports as open');

    // ------------------------------------------- open never overwrites
    writeFileSync(openedPath, `${body}\n\nnotes a human wrote\n`);
    r = runTool(['open', '--tag', 'v0.400.0'], opened);
    assert.equal(r.status, 1, 'open refuses to overwrite an existing record');
    assert.ok(/never overwrites/.test(r.stderr), 'the refusal says why');
    assert.ok(readFileSync(openedPath, 'utf8').includes('notes a human wrote'),
        'the existing record is untouched by the refused open');

    // ------------------------------------------------ open: malformed tag
    r = runTool(['open', '--tag', 'nightly'], opened);
    assert.equal(r.status, 1, 'open refuses a tag that is not vX.Y.Z');

    // ------------------------------------ assert: --record off the path
    const elsewhere = join(scratch, 'elsewhere.md');
    writeFileSync(elsewhere, readFileSync(openedPath, 'utf8'));
    r = runTool(['assert', '--tag', 'v0.400.0', '--record', elsewhere], empty);
    assert.equal(r.status, 0, '--record accepts a record kept somewhere else');
    r = runTool(['assert', '--tag', 'v0.400.0', '--record', join(scratch, 'nope.md')], empty);
    assert.equal(r.status, 1, '--record relocates the record, it does not waive it');

    // ------------------------------- coverage: no records directory at all
    r = runTool(['coverage', '--repo', root], join(scratch, 'absent'));
    assert.equal(r.status, EXIT_UNAVAILABLE,
        `coverage exits ${EXIT_UNAVAILABLE} when the records directory is not in the checkout`);
    assert.ok(/PLATFORM repo/.test(r.stderr),
        'the unavailable message says where the records actually live');

    // ------------------------- coverage: a well-formed tag with no record
    const repoA = makeRepo('repoA', { version: '0.400.0', tags: ['v0.400.0'] });
    const coverEmpty = makeRecordsDir('cover-empty');
    r = runTool(['coverage', '--repo', repoA], coverEmpty);
    assert.equal(r.status, 1, 'coverage fails when a release tag has no record');
    assert.ok(/⬜ v0\.400\.0/.test(r.stdout), 'the missing tag is listed');
    assert.ok(/which is why this is a gate/.test(r.stdout), 'the summary says why this is a gate');

    // ------------------------------------- coverage: the same tag, recorded
    const coverFull = makeRecordsDir('cover-full');
    assert.equal(runTool(['open', '--tag', 'v0.400.0'], coverFull).status, 0, 'open for coverage fixture');
    r = runTool(['coverage', '--repo', repoA], coverFull);
    assert.equal(r.status, 0, `coverage passes once the record exists (${r.stdout}${r.stderr})`);
    assert.ok(/✅ v0\.400\.0/.test(r.stdout), 'the covered tag is listed');

    // ------------------- coverage: the declared version is its own gate
    //
    // This is the step-1 half. Bumping package.json without opening a
    // record must fail even though no tag exists yet, because the bump
    // commit is what the tag will be pinned to.
    const repoBumped = makeRepo('repoBumped', { version: '0.401.0', tags: [] });
    r = runTool(['coverage', '--repo', repoBumped], coverFull);
    assert.equal(r.status, 1, 'coverage fails on a version bump with no record opened');
    assert.ok(/⬜ v0\.401\.0\s+declared by package\.json/.test(r.stdout),
        'the refusal names the declared version, not a tag');

    // --------------- coverage: a tag release.yml would refuse is not ours
    //
    // v0.335.0 in the real repo is exactly this: a signed tag on a commit
    // whose package.json still reads 0.334.0. release.yml's verify-tag
    // refuses it, so it can never have produced a release, and demanding
    // an account of it would wedge THIS gate on a stray tag
    // instead of on the missing record it exists to catch. Reported, not
    // fatal.
    const repoStray = makeRepo('repoStray', { version: '0.400.0', tags: ['v0.400.0', 'v0.402.0'] });
    r = runTool(['coverage', '--repo', repoStray], coverFull);
    assert.equal(r.status, 0, 'a version-mismatched tag does not fail the record gate');
    assert.ok(/!! v0\.402\.0\s+not a release tag/.test(r.stdout),
        'the mismatched tag is reported loudly rather than passing in silence');
    assert.ok(/declares 0\.400\.0/.test(r.stdout),
        'the report says what the tag commit actually declared');

    // ----------------------------------------------- the real repository
    if (!recordsAvailable()) {
        console.log('SKIP (partial): release-record.smoke.js ran its gates against fixtures, but the '
            + 'real coverage check needs the platform repo\'s release records, which are not in this '
            + `checkout (expected at ${RECORDS_DIR}). Check the platform repo out above this one, or `
            + 'set XCHAIN_WALLET_RELEASE_RECORDS, to run it.');
    } else {
        const real = spawnSync(process.execPath, [TOOL_ABS, 'coverage', '--repo', root], {
            encoding: 'utf8', cwd: root,
        });
        assert.equal(real.status, 0,
            `every release tag and the declared version have a §6 record\n${real.stdout}${real.stderr}`);
        console.log(real.stdout.trim());

        // §6 itself has to say the record is gated, because the spec is
        // what a release manager reads, and a gate nobody was told about
        // is discovered as an obstruction rather than followed as a step.
        // It used to say "copy its TEMPLATE.md" and nothing more, which is
        // the instruction v0.334.0 was cut under.
        const specPath = join(RECORDS_DIR, '..', '..', 'specs', 'wallet-release-rails.md');
        if (existsSync(specPath)) {
            const spec = readFileSync(specPath, 'utf8');
            assert.ok(/release-record\.mjs open --tag/.test(spec),
                '§6 names the command that opens the record, not a manual copy');
            // Anchored to the precondition sentence rather than to the bare
            // finding id: §6 already cited in its run log while step
            // 1 still said "copy its TEMPLATE.md", so a bare id match passed
            // against exactly the wording this is here to prevent.
            assert.ok(/It is a precondition, not a convention/.test(spec),
                '§6 says the record is a precondition rather than a convention');
            assert.ok(/publish\.sh` refuses a production publish without an instantiated §6 release record/.test(spec),
                'step 5 states the publish-side refusal alongside the rehearsal one');
        } else {
            console.log(`SKIP (partial): no release spec at ${specPath}; §6 wording unchecked.`);
        }
    }

    console.log('PASS release-record.smoke.js');
} finally {
    for (const fn of cleanups) fn();
}
