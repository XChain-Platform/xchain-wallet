// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  S4: the release workflow's safety properties.
//
// The remotes are shared and a second coder pushes to them. A
// tag-triggered workflow holding code-signing secrets is a
// signed-malware factory, and the manual store-publish gate does not
// help: the output of a compromised run is a properly signed, notarized
// binary that a direct downloader never runs past a store at all.
//
// Half the protection lives in repository settings, which no test can
// reach (the release CI-setup doc tracks those). The half that lives in
// the workflow file is pinned here, because each of these is one
// plausible edit away from being undone by someone fixing something
// else, and none of them fails visibly when it breaks. A workflow that
// has quietly started handing secrets to pull requests still goes
// green.

import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { docsAvailable, readDoc, WALLET_DOCS } from '../_docs-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const WORKFLOW = '.github/workflows/release.yml';
assert.ok(existsSync(join(root, WORKFLOW)), `${WORKFLOW} exists`);
const wf = read(WORKFLOW);

// Split the file into top-level sections and jobs by indentation. A
// real YAML parser would be better, but adding a dependency to read one
// file is worse, and the shape here is fixed and simple.
function jobBlocks(text) {
    const lines = text.split('\n');
    const jobsAt = lines.findIndex((l) => l === 'jobs:');
    assert.ok(jobsAt >= 0, 'workflow has a jobs: block');
    const out = new Map();
    let current = null;
    for (const line of lines.slice(jobsAt + 1)) {
        const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
        if (m) {
            current = m[1];
            out.set(current, []);
            continue;
        }
        if (current) out.get(current).push(line);
    }
    return new Map([...out].map(([k, v]) => [k, v.join('\n')]));
}

const jobs = jobBlocks(wf);
assert.ok(jobs.size >= 4, `workflow defines several jobs (found ${jobs.size})`);

// --- 1. Triggers --------------------------------------------------------

const header = wf.split('\njobs:')[0];
assert.ok(/on:\s*\n\s*push:\s*\n\s*tags:\s*\n\s*- 'v\*'/.test(header),
    'release.yml triggers on v* tags');

// The one that matters most. `pull_request_target` in particular runs
// with repository context and would expose secrets to a fork's branch.
for (const trigger of ['pull_request', 'pull_request_target', 'issue_comment',
    'workflow_call', 'repository_dispatch']) {
    assert.ok(!new RegExp(`^\\s{2}${trigger}:`, 'm').test(header),
        `release.yml must not trigger on ${trigger} (it can read signing secrets)`);
}

// A cancelled release build is worse than a slow one: it looks merely
// interrupted, and someone re-runs it and half-trusts the result.
assert.ok(/cancel-in-progress:\s*false/.test(header),
    'release builds are never cancelled mid-flight');

// --- 2. Every secret-bearing job sits behind the approval gate ---------

// Anything that looks like a code-signing credential. Deliberately
// broad: a new signing secret should trip this until its job is gated.
const SIGNING_SECRET = /secrets\.(MACOS_|APPLE_|AZURE_|CSC_|WINDOWS_|GPG_|SIGNING_)/;

for (const [name, block] of jobs) {
    if (!SIGNING_SECRET.test(block)) continue;
    assert.ok(/^\s{4}environment:\s*release-signing\s*$/m.test(block),
        `job '${name}' reads a signing secret and must run in the `
        + 'release-signing environment, which is the required-reviewer gate');
}

// And the gate must actually be used by something, or the check above
// is vacuously true and nobody would notice.
const gated = [...jobs].filter(([, b]) => /environment:\s*release-signing/.test(b));
assert.ok(gated.length >= 2,
    `expected the macOS and Windows signing lanes to be gated (found ${gated.length})`);

// --- 3. K1 never reaches a runner --------------------------------------

// §4: "K1 is never provisioned to any CI runner; manifest signing
// happens only on the release machine." A runner that could sign the
// manifest would turn every path into this workflow into a path to a
// signed release.
for (const forbidden of ['XCHAIN_RELEASE_GPG_KEY', 'GNUPGHOME']) {
    assert.ok(!wf.includes(forbidden),
        `release.yml must not reference ${forbidden}: manifest signing is not a CI job`);
}

// `release:sign` may appear, but only as instructions printed for the
// maintainer. What must never appear is CI actually running it. Checked
// per line rather than per file, because banning the string outright
// would forbid the run summary from telling anyone what to do next.
for (const line of wf.split('\n')) {
    if (!line.includes('release:sign')) continue;
    assert.ok(/echo|^\s*#/.test(line),
        `release.yml invokes signing on a runner: ${line.trim()}`);
}

// --- 4. Nothing publishes ----------------------------------------------

// v1 has no CI auto-publish to any surface (§7). These are the shapes
// that would mean otherwise.
// Comments and printed summaries are excluded: the workflow header
// explains at length that it does NOT publish, and naming the things it
// refuses to do is the clearest way to say so.
const executableLines = wf.split('\n')
    .filter((l) => !/^\s*#/.test(l) && !l.includes('echo'));

for (const pattern of [
    /downloads\.xchain\.io/,
    /aws s3|rclone|scp .*@/,
    /chrome-webstore|webstore-upload/i,
    /fastlane|app-store-connect .*upload|altool .*--upload/i,
    /softwareupdate|gh release create/,
]) {
    const offender = executableLines.find((l) => pattern.test(l));
    assert.ok(!offender,
        `release.yml must not publish (matched ${pattern} on: ${offender}); `
        + 'humans push the final button in v1');
}

// --- 5. Delta metadata never ships -------------------------------------

// Differential updates are a non-goal (§7), and a stray .blockmap in the
// staging dir hard-fails the artifact-set gate at signing time. Dropping
// them in CI means that failure never reaches the release machine.
const desktopJobs = [...jobs].filter(([n]) => n.startsWith('desktop-'));
assert.ok(desktopJobs.length === 3,
    `expected three desktop lanes (linux, macos, windows), found ${desktopJobs.length}`);
for (const [name, block] of desktopJobs) {
    assert.ok(/\.blockmap/.test(block),
        `desktop lane '${name}' must drop delta metadata before uploading`);
}

// --- 6. Reproducibility input ------------------------------------------

// Without SOURCE_DATE_EPOCH pinned to the tag commit, the bundles embed
// build time and the §6 step 3 reproduce check can never match. That
// failure looks like tampering.
for (const [name, block] of jobs) {
    if (!/upload-artifact/.test(block)) continue;
    if (name === 'desktop-windows') continue; // signed, not in the reproduce set
    assert.ok(/SOURCE_DATE_EPOCH/.test(block),
        `job '${name}' produces artifacts and must pin SOURCE_DATE_EPOCH`);
}

// --- 7. The tag must be what it claims ---------------------------------

assert.ok(jobs.has('verify-tag'), 'workflow has a verify-tag gate');
const verifyTag = jobs.get('verify-tag');
assert.ok(/package\.json.*version|version.*package\.json/s.test(verifyTag),
    'verify-tag checks the tag against the committed version');
for (const [name, block] of jobs) {
    if (name === 'verify-tag') continue;
    assert.ok(/needs:.*verify-tag/s.test(block),
        `job '${name}' must depend on verify-tag so a bad tag fails before any build`);
}

// --- 8. The settings half is written down ------------------------------

//  moved the settings half to the sibling xchain-documentation
// checkout and rewrote it for a reader verifying a release rather than for
// the maintainer configuring one, so the exact console labels ("Required
// reviewers", "tag protection") are gone. The three controls they named are
// what this pins now; each is the reason the workflow file alone is not
// enough.
const SETUP_DOC = 'components/wallet/release/ci-setup.md';
assert.ok(wf.includes('https://docs.xchain.io/components/wallet/release/ci-setup'),
    'release.yml points at the settings the file itself cannot enforce');

if (docsAvailable()) {
    // Whitespace-flattened: the doc is hard wrapped, so any phrase worth
    // asserting on will eventually straddle a line break.
    const setup = readDoc('release', 'ci-setup.md').replace(/\s+/g, ' ');
    for (const [control, re] of [
        ['a protected signing environment gated on human approval',
            /protected deployment environment that requires a human reviewer to approve/i],
        ['signing credentials scoped to that environment, never repository-wide',
            /scoped to the protected environment, never stored as a repository-wide secret/i],
        ['release-tag creation restricted to the maintainer',
            /restricted to the release maintainer through a repository tag ruleset/i],
    ]) {
        assert.match(setup, re, `${SETUP_DOC} covers ${control}`);
    }
    assert.match(setup,
        /manifest-signing key never appears here, and must never be added/i,
        `${SETUP_DOC} states that the manifest-signing key never becomes a CI secret`);
} else {
    console.log('SKIP (partial): release-ci smoke - the settings-doc half needs the sibling '
        + `xchain-documentation checkout (expected at ${WALLET_DOCS}).`);
}

// --- 8b. The iOS lane ( §5, S4b) --------------------------------

// Two properties, and neither fails visibly when it breaks.
//
// The profile: a mobile store artifact built at `default` carries the
// §2.3 review-hidden surfaces. Dropping the env var produces a perfectly
// good ipa of the wrong app, and the only later signal is
// expected-artifacts.txt refusing it at the release machine, long after
// the build looked green.
//
// The gate: the archive/export steps must stay conditional on the App
// Store Connect key being present. Until K2 enrollment completes there is
// no key, and an ungated archive step turns every release tag red for a
// reason that has nothing to do with the release.
assert.ok(jobs.has('mobile-ios'), 'workflow has an iOS lane');
const ios = jobs.get('mobile-ios');

assert.ok(/XCHAIN_BUILD_PROFILE:\s*store/.test(ios),
    'the iOS lane must build the web shell at the `store` profile, or the ipa '
    + 'carries the surfaces  §2.3 compiles out');

assert.ok(/ASC_KEY_ID:\s*\$\{\{\s*secrets\.APPLE_API_KEY_ID/.test(ios),
    'the iOS lane reads the ASC key id into env, which is what its steps gate on');

// The invariant is about CREDENTIALS, not about the script's name, and saying
// it that way matters now that `ios-archive.sh` has two callers ( row
// 22): a gated signed one, and an ungated one that passes
// XCHAIN_IOS_ARCHIVE_UNSIGNED=1 and needs no Apple account at all. The original
// check read back 600 characters from the FIRST occurrence of the script name,
// which cannot tell two callers apart - it would have found whichever came
// first and reported on the wrong one. Split into step blocks instead, and gate
// on what the step actually asks for.
const iosSteps = ios.split(/^ {6}- (?=name:|uses:|run:)/m);
for (const step of ['ios-archive.sh', 'ios-export.sh']) {
    const callers = iosSteps.filter((b) => new RegExp(`run: bash tools/release/${step}`).test(b));
    assert.ok(callers.length > 0, `the iOS lane runs ${step}`);
    for (const caller of callers) {
        if (/XCHAIN_IOS_ARCHIVE_UNSIGNED/.test(caller)) continue; // needs no key
        assert.ok(/if:\s*env\.ASC_KEY_ID\s*!=\s*''/.test(caller),
            `${step} runs unconditionally while needing App Store Connect credentials, so it turns every release `
            + 'tag red for a reason that has nothing to do with the release. Gate it on env.ASC_KEY_ID, or have it '
            + 'ask for unsigned mode.');
    }
    // The signed path must still exist and still be gated: dropping it and
    // keeping only the unsigned one would satisfy the loop above while quietly
    // removing the only step that can produce something uploadable.
    assert.ok(
        callers.some((c) => /if:\s*env\.ASC_KEY_ID\s*!=\s*''/.test(c)),
        `${step} has no credential-gated caller left, so the lane can never archive for distribution`,
    );
}

// The half that needs no Apple account must actually be ungated, or
// landing this lane early bought nothing.
const simBuild = /-destination 'generic\/platform=iOS Simulator'/.test(ios);
assert.ok(simBuild, 'the iOS lane builds for the simulator with no signing identity');

// --- 9. The PR-triggered workflow holds no signing secrets -------------

// ci.yml runs on pull_request. If a signing secret ever appears there,
// every protection above is bypassed by opening a pull request.
const ci = read('.github/workflows/ci.yml');
assert.ok(/pull_request/.test(ci), 'ci.yml runs on pull_request (as expected)');
assert.ok(!SIGNING_SECRET.test(ci),
    'ci.yml runs on pull_request and must never read a signing secret');

// --- 10. Every workflow that builds the web SPA raises Node's heap ------
//
// The web bundle is one large synchronous graph carrying every chain, and
// Node sizes its default old-space from the machine it starts on. A
// developer box builds it happily; a GitHub-hosted runner dies at ~2.0 GB
// with `FATAL ERROR: ... JavaScript heap out of memory`.
//
// This is pinned rather than remembered because it has already been
// forgotten once, in the way that matters most. release.yml hit the wall
// on 2026-08-01 and was fixed the same day (d3f8a4ec). mobile.yml builds
// the SAME bundle in the SAME way and did not get the fix, so it failed on
// all three of its runs (the v0.334.0 tag pushes, 2026-08-02) at that one
// line. The cost was not one red workflow: that step is upstream of
// `bundleRelease`, so no Gradle build has ever run in CI, and every
// artifact-level gate below it in mobile.yml - the ones written precisely
// because a source-level assertion cannot see what packaging did - has
// never executed there at all.
//
// Any future shell that builds the SPA on a runner inherits the same wall.
//
// This check itself then proved the point, twice over (2026-08-03). It named
// its two workflows in a literal list while its own comment promised "any
// future shell", so ci.yml was never looked at; and its scope test knew only
// the two spellings those two files happened to use, so it could not have
// seen ci.yml's `pnpm -r --if-present build` even if it had. ci.yml's build
// job duly aborted at 2042 MB on master (run 30787587046), taking with it the
// three artifact gates that run after it - no-dev-mock, no-@trezor, and SRI -
// none of which had executed since. So: enumerate the directory, never a
// list, and match on BUILDING rather than on a known incantation.
const WORKFLOW_DIR = '.github/workflows';
const workflows = readdirSync(join(root, WORKFLOW_DIR)).filter((f) => /\.ya?ml$/.test(f));
assert.ok(workflows.length >= 3, `found the workflow directory (${workflows.length} files)`);

// `-r`/`--recursive` sweeps every package and therefore includes web. The
// other two forms name it directly.
const BUILDS_SPA = /pnpm\s+(?:[^\n]*\s)?(?:-r|--recursive)\s[^\n]*\bbuild\b|pnpm\s+-C\s+packages\/web[^\n]*\bbuild\b|pnpm\s+--filter\s+"?@xchain-wallet\/(?:web|mobile)/;

const spaBuildingJobs = [];
for (const file of workflows) {
    const path = `${WORKFLOW_DIR}/${file}`;
    const text = read(path);
    // Scoped to the JOB, not the file: a ceiling set on some other job in the
    // same workflow is not protecting this one, and a file-wide grep would
    // read as though it were.
    for (const [name, block] of jobBlocks(text)) {
        if (!BUILDS_SPA.test(block)) continue;
        spaBuildingJobs.push(`${file}:${name}`);
        assert.match(block, /NODE_OPTIONS:\s*--max-old-space-size=\d{4,}/,
            `${path} job "${name}" builds the web SPA on a runner and must raise Node's `
            + 'old-space ceiling. Without it the step dies at ~2.0 GB, and every gate '
            + 'after it in that job silently never executes');
    }
}
// A detector that stops matching would otherwise turn this whole section into
// a no-op that passes, which is the failure it exists to prevent. Asserted per
// WORKFLOW rather than as a count, because the way this actually broke was a
// detector that knew two spellings and not a third: losing exactly one file
// still clears any count threshold low enough to be safe to write.
for (const file of ['ci.yml', 'mobile.yml', 'release.yml']) {
    assert.ok(spaBuildingJobs.some((j) => j.startsWith(`${file}:`)),
        `the SPA-build detector no longer sees any job in ${file}. Either that `
        + 'workflow genuinely stopped building the SPA, or the detector went stale '
        + `and this section is now silently checking nothing. Found: ${spaBuildingJobs.join(', ') || '(none)'}`);
}

// . §6 step 1 says a release tag is pinned to a commit that green
// CI already validated. That was procedure and nothing else, so v0.334.0
// was cut on a commit whose CI run was cancelled with four jobs red, and
// the release lane ran green over the top of it. The gate now exists; this
// holds it in place, because a gate that can be deleted without a test
// going red is a comment.
{
    const verifyTag = jobs.get('verify-tag');
    assert.ok(verifyTag, 'release.yml must keep a verify-tag job');

    assert.ok(verifyTag.includes('tools/release/verify-validated-commit.mjs'),
        'release.yml`s verify-tag job must run tools/release/verify-validated-commit.mjs. '
        + 'Without it the workflow checks WHO SIGNED the tag and never whether anyone '
        + 'validated the commit it points at, which is exactly how v0.334.0 was cut from '
        + 'a commit whose CI was cancelled with build/test/audit/drift-guards all red.');

    assert.ok(existsSync(join(root, 'tools/release/verify-validated-commit.mjs')),
        'the step-1 gate script is referenced by release.yml but does not exist, so every '
        + 'release would fail at that step rather than be gated by it.');

    // The gate reads workflow runs. Without `actions: read` the API answers
    // 404, which the gate treats as a refusal - so a missing permission
    // turns it from a gate into an outage. Assert it here rather than
    // discover it on a release night.
    assert.ok(/^\s{4}permissions:\s*$/m.test(verifyTag)
        && /^\s{6}actions:\s*read\s*$/m.test(verifyTag),
        'the verify-tag job must request `actions: read`; `contents: read` alone cannot '
        + 'list workflow runs and the gate fails closed on the resulting 404.');

    // It has to run BEFORE anything holding a signing secret, which is the
    // whole reason it lives in this job rather than its own. Every other
    // job depending on verify-tag is what proves that ordering.
    for (const [name, block] of jobs) {
        if (name === 'verify-tag') continue;
        assert.ok(/^\s{4}needs:.*\bverify-tag\b/m.test(block),
            `job \`${name}\` does not need verify-tag, so it can start on a tag whose `
            + 'commit was never validated and whose signature was never checked.');
    }
}

console.log('OK: release CI smoke ( S4: trigger surface, environment gate, no K1 on runners, no auto-publish, '
    + 'the §6 step-1 validated-commit gate, and every SPA-building workflow raises the Node heap '
    + 'ceiling that killed all three mobile.yml runs)');
