// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for S4: the release workflow's safety properties.
//
// The remotes are shared and a second coder pushes to them. A
// tag-triggered workflow holding code-signing secrets is a
// signed-malware factory, and the manual store-publish gate does not
// help: the output of a compromised run is a properly signed, notarized
// binary that a direct downloader never runs past a store at all.
//
// Half the protection lives in repository settings, which this offline
// suite cannot reach. That half is measured by
// `tools/release/verify-ci-controls.mjs`, which reads the live settings
// with `gh api` and compares them to what the public page claims. It is
// not part of `npm run ci` (network, authenticated `gh`), so it is run
// before a release and after any settings or page change - and the first
// time it ran it found the page's third false claim in nine days
// (2026-08-12: signing credentials described as environment-scoped while
// all ten sat at repository scope).
//
// The half that lives in the workflow file is pinned here, because each
// of these is one plausible edit away from being undone by someone
// fixing something else, and none of them fails visibly when it breaks.
// A workflow that has quietly started handing secrets to pull requests
// still goes green.

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

// A boundary-aware "does the file reference this exact URL" check: a plain
// substring search would also match the URL appearing as a piece of some
// other, longer URL (e.g. with more path segments tacked on), which would
// let the assertion pass without the file actually pointing at this page.
function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function fileReferencesUrl(text, url) {
    return new RegExp(`(^|[^\\w./-])${escapeRegExp(url)}(?![\\w./-])`).test(text);
}

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

// --- 2. Every secret-bearing job sits inside the restricted environment -

// Anything that looks like a code-signing credential. Deliberately
// broad: a new signing secret should trip this until its job is gated.
const SIGNING_SECRET = /secrets\.(MACOS_|APPLE_|AZURE_|CSC_|WINDOWS_|GPG_|SIGNING_)/;

for (const [name, block] of jobs) {
    if (!SIGNING_SECRET.test(block)) continue;
    assert.ok(/^\s{4}environment:\s*release-signing\s*$/m.test(block),
        `job '${name}' reads a signing secret and must run in the `
        + 'release-signing environment, whose deployment policy admits only the '
        + 'release tag pattern (there is no reviewer gate on it)');
}

// And the environment must actually be used by something, or the check
// above is vacuously true and nobody would notice.
const gated = [...jobs].filter(([, b]) => /environment:\s*release-signing/.test(b));
assert.ok(gated.length >= 2,
    `expected the macOS and Windows signing lanes to be gated (found ${gated.length})`);

// --- 2b. This file must not claim the controls that do not exist -------
//
// corrected the public page. The same two false claims were also
// written into this workflow's own header ("required-reviewer approval
// gate", "tag creation is restricted to the release maintainer by a tag
// protection rule"), which is worse in one way: a reader who opens
// release.yml to check the page's story finds the page's story repeated
// back, and reads two independent sources agreeing. Neither exists, and
// by operator decision 2026-08-03 neither will. Guarded here so restoring
// the comfortable wording is red rather than invisible.
for (const [claim, re] of [
    ['a required-reviewer approval gate on the signing environment',
        /required[- ]reviewer|reviewer approves|requires a human reviewer/i],
    ['a rule restricting who may create a release tag',
        /tag protection rule|tag ruleset/i],
]) {
    const offender = wf.split('\n').find((l) => re.test(l));
    assert.ok(!offender,
        `release.yml claims ${claim}, which is not in force: ${offender?.trim()}`);
}

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

// --- 6b. A macOS build step must name a signing identity ---------------
//
// App-builder-lib reads an explicit null identity as "do not
// sign", checked BEFORE it looks at CSC_LINK. So a mac step holding the
// Developer ID cert and the notarization credentials, and nothing else,
// signed nothing, notarized nothing, exited 0 and said so in one info
// line. That is how the direct download channel shipped unsigned while
// reading as fully configured.
//
// The identity now defaults from the builder config whenever a certificate
// was supplied (MAC_IDENTITY, pinned by desktop-packaging.smoke.js), so
// dropping the env line no longer restores that defect. This check is the
// second layer and stays: it keeps each step naming the signer it intends
// rather than inheriting one, and it is where the notarization credentials
// are asserted to travel beside the certificate.
//
// A `--mac mas` step is exempt: `mas.identity` has its own non-null
// default in the builder config, which mas-lane.smoke.js pins.
function stepBlocks(jobBlock) {
    const out = [];
    let current = null;
    for (const line of jobBlock.split('\n')) {
        if (/^ {6}- /.test(line)) {
            current = [line];
            out.push(current);
            continue;
        }
        // A step ends where the next one begins or the job's key list resumes.
        if (current && line.trim() !== '' && !/^ {8}/.test(line)) current = null;
        else if (current) current.push(line);
    }
    return out.map((s) => s.join('\n'));
}

let macBuildSteps = 0;
for (const [name, block] of jobs) {
    for (const step of stepBlocks(block)) {
        const run = step.match(/^\s*run: (.*)$/m)?.[1] ?? '';
        if (!/dist .*--mac/.test(run)) continue;
        if (/--mac\s+mas\b/.test(run)) continue;
        macBuildSteps++;
        const stepName = step.match(/- name: (.*)/)?.[1]?.trim() ?? run.trim();
        assert.ok(/^\s*CSC_IDENTITY_NAME:\s*\S/m.test(step),
            `job '${name}' step '${stepName}' builds the macOS Developer ID channel `
            + 'and names no CSC_IDENTITY_NAME, so which certificate it signs with is '
            + 'left to the builder config default rather than stated here');
        // Signing without notarizing is its own quiet failure: Gatekeeper
        // rejects an un-notarized signed app on first launch just as hard.
        assert.ok(/APPLE_API_KEY_ID:/.test(step),
            `job '${name}' step '${stepName}' signs but passes no APPLE_API_KEY_ID, `
            + 'so notarize is false and Gatekeeper blocks the result anyway');
    }
}
assert.ok(macBuildSteps >= 2,
    'expected the production and rehearsal macOS build steps to be checked '
    + `for a signing identity (found ${macBuildSteps}); if the steps were renamed `
    + 'or restructured this check is passing vacuously');

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

// a later change moved the settings half to the sibling xchain-documentation
// checkout and rewrote it for a reader verifying a release rather than for
// the maintainer configuring one, so the exact console labels ("Required
// reviewers", "tag protection") are gone. The three controls they named are
// what this pins now; each is the reason the workflow file alone is not
// enough.
const SETUP_DOC = 'components/wallet/release/ci-setup.md';
assert.ok(fileReferencesUrl(wf, 'https://docs.xchain.io/components/wallet/release/ci-setup'),
    'release.yml points at the settings the file itself cannot enforce');

// Everything below pins the page's WORDING, which is all an offline suite
// can do, and wording is not truth: the page can be perfectly self-
// consistent and still describe a repository that does not exist. The
// settings-side audit is the only thing that closes that, so its absence
// has to be red here. Without this assertion, deleting the audit restores
// exactly the state that let three false claims reach a public page: prose
// about settings, checked only against itself.
assert.ok(existsSync(join(root, 'tools/release/verify-ci-controls.mjs')),
    'tools/release/verify-ci-controls.mjs exists: it is what measures the page against the '
    + 'live repository settings, and this suite can only check the page against itself');

if (docsAvailable()) {
    // Whitespace-flattened: the doc is hard wrapped, so any phrase worth
    // asserting on will eventually straddle a line break.
    const setup = readDoc('release', 'ci-setup.md').replace(/\s+/g, ' ');

    // THIS BLOCK USED TO PIN TWO CONTROLS THAT DO NOT EXIST, and that is
    // why the page went on claiming them. It required the doc to say the
    // signing environment "requires a human reviewer to approve" and that
    // tag creation is "restricted to the release maintainer through a
    // repository tag ruleset". Both were measured in 2026-08 and neither is
    // in force: environment reviewers need a plan tier this org does not
    // have, and a tag rule cannot exempt one named person while another
    // account holds admin, so none was created rather than a partial one.
    //
    // The effect was worse than a stale test. Correcting the page would
    // have REDDENED this smoke, so the true state could not be documented
    // without first fixing the gate that demanded the false state. A test
    // that pins a security claim rather than a security property will
    // always fail in that direction.
    //
    // What is pinned now is what is actually in force, plus the two
    // absences stated out loud, because an absent control that is written
    // down is the thing being relied on here.
    for (const [control, re] of [
        ['the signing environment restricted to the release tag pattern',
            /restricted to the release tag pattern/i],
        ['signing credentials scoped to that environment, never repository-wide',
            /scoped to the protected environment, never stored as a repository-wide secret/i],
        ['the signed-tag requirement, which is the control everything rests on',
            /tag must carry a cryptographic signature from the maintainer/i],
        ['the absent approval step, stated rather than implied',
            /there is no human approval step/i],
        ['the absent tag rule, stated rather than implied',
            /there is no rule restricting who can create a release tag/i],
        ['why no partial tag rule was created',
            /protects nothing and reads[^.]*exactly like a rule that works/i],
        ['the artifact signature check that precedes manifest signing',
            /every artifact is checked against the code signature/i],
    ]) {
        assert.match(setup, re, `${SETUP_DOC} covers ${control}`);
    }

    // And the page must NOT re-acquire either false claim. A future edit
    // restoring the old wording would otherwise pass every assertion above,
    // since those only require the true statements to be present.
    for (const [claim, re] of [
        ['a human-reviewer approval gate', /requires a human reviewer to approve/i],
        ['a maintainer-only tag ruleset',
            /restricted to the release maintainer through a repository tag ruleset/i],
    ]) {
        assert.doesNotMatch(setup, re,
            `${SETUP_DOC} must not claim ${claim}: it does not exist, and this page is `
            + 'what a reader uses to decide whether a release could only have come from '
            + 'an intentional run');
    }

    // Those two guards pin the exact sentences that were there, which is
    // one paraphrase away from being useless: "gated on an approving
    // reviewer" says the same false thing and matches neither. So the
    // property, not the wording - the page may name a reviewer gate or a
    // tag rule ONLY to say it is absent. Any sentence that mentions one
    // without denying it is asserting it.
    //
    // This is not hypothetical: §2 went on saying an environment-scoped
    // secret is "only readable by a job that has already cleared the
    // approval gate above" after §1 had been corrected to say there is no
    // such gate, so the page both denied and asserted the same control
    // (found 2026-08-04, re-scan).
    //
    // BOTH HALVES OF THAT GUARD LEAKED, measured by mutation 2026-08-12
    // verification, and the leaks compose into exactly the claim
    // this whole block exists to keep off the page:
    //
    //   1. The mention vocabulary was three phrases lifted from the old
    //      wording, so "held until the release maintainer approves it from
    //      the deployments tab" was never even examined.
    //   2. "Contains a negation token" is not "denies the control". The
    //      survivor that proves it is "The tag ruleset does not allow
    //      anyone but the release maintainer to create a v* tag" - the
    //      false claim itself, stated in the affirmative, waved through on
    //      the `\bnot\b` inside "does not allow".
    //
    // So the vocabulary is now the concept rather than the sentence, and a
    // sentence must carry an EXPLICIT statement of absence, not merely a
    // negation somewhere in it. Phrasings that describe the control working
    // ("does not start until", "does not allow anyone but") no longer count
    // as denying that it exists.
    const ABSENCE = new RegExp([
        'there (?:is|are) no\\b',
        '\\bno such\\b',
        '\\bnone was created\\b',
        '\\bno partial rule\\b',
        'does not exist|do not exist|neither control exists',
        'is not available|are not available|not available on',
        'was not created|were not created',
        'cannot be (?:expressed|created)|could not be created',
        'refuses to create',
        'not in force',
        'previously said',
        'would both fail',
        'never will',
    ].join('|'), 'i');

    // Sentences that use this vocabulary about a DIFFERENT, real control.
    // §4's fork-run approval is a genuine platform behaviour and has nothing
    // to do with the per-run reviewer gate on the signing environment.
    //
    // Deliberately narrow: "pull request" alone must NOT exempt a sentence.
    // §2's whole argument for environment scoping is that a repository-wide
    // secret is readable "from a pull request branch", and that is the exact
    // sentence which once went on to invoke the non-existent approval gate.
    // An exemption keyed on "pull request" hides the one regression this
    // guard was written for (measured 2026-08-12: it did).
    const OTHER_CONTROL = /\bfork(?:s|ed)?\b|outside collaborator/i;

    const sentences = setup.split(/(?<=[.!?])\s+/);
    for (const [control, mention] of [
        ['a reviewer approval gate on the signing environment',
            /\breviewers?\b|\bapproval (?:gate|step|rule)\b|\bapproves?\b|\bapproving\b|\bsigns? off\b|\bsigning off\b|\bsign-off\b|waiting for approval|deployments tab|human review\b/i],
        // Either the settings vocabulary, or any sentence that puts a rule
        // and a tag together - "a rule restricts tag creation to the
        // maintainer" names no console label at all.
        ['a rule restricting who may create a release tag',
            /tag ruleset|tag protection|tag[- ]protection|restricted to the release maintainer|who (?:can|may) create (?:a |the )?(?:release )?tag/i],
    ]) {
        for (const sentence of sentences) {
            const names = mention.test(sentence)
                || (control.includes('release tag')
                    && /\brulesets?\b|\brules?\b|protection/i.test(sentence) && /\btags?\b/i.test(sentence));
            if (!names || OTHER_CONTROL.test(sentence)) continue;
            assert.match(sentence, ABSENCE,
                `${SETUP_DOC} mentions ${control} in a sentence that does not state its `
                + `absence, so the page is asserting a control that does not exist: `
                + `"${sentence.trim()}"`);
        }
    }

    // The verification list is the sharp end of this page: a reader runs it
    // to decide whether to trust a release. Its own count and its bullets
    // have to agree. They already drifted once - the artifact
    // signature check was appended as a fifth bullet under a sentence still
    // reading "These four", which reads as one step having been dropped
    // silently, on exactly the list where a missing step is the failure.
    const raw = readDoc('release', 'ci-setup.md');
    const section = raw.split(/^## 5\. /m)[1];
    assert.ok(section, `${SETUP_DOC} has a "## 5." verification section`);
    const body = section.split(/^(?:---|## )/m)[0];
    const bullets = body.split('\n').filter((l) => /^- /.test(l));
    const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five',
        'six', 'seven', 'eight', 'nine', 'ten'];
    const claimed = /These (\w+) are what can actually be verified/i.exec(body);
    assert.ok(claimed, `${SETUP_DOC} §5 states how many steps can actually be verified`);
    assert.equal(NUMBER_WORDS.indexOf(claimed[1].toLowerCase()), bullets.length,
        `${SETUP_DOC} §5 says "These ${claimed[1]}" over ${bullets.length} steps. `
        + 'A reader counting the list finds a different number than the page claims, on the '
        + 'one list whose whole purpose is that no step goes missing');
    assert.match(setup,
        /manifest-signing key never appears here, and must never be added/i,
        `${SETUP_DOC} states that the manifest-signing key never becomes a CI secret`);
} else {
    console.log('SKIP (partial): release-ci smoke - the settings-doc half needs the sibling '
        + `xchain-documentation checkout (expected at ${WALLET_DOCS}).`);
}

// --- 8b. The iOS lane (§5, S4b) --------------------------------

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
    + 'carries the surfaces §2.3 compiles out');

assert.ok(/ASC_KEY_ID:\s*\$\{\{\s*secrets\.APPLE_API_KEY_ID/.test(ios),
    'the iOS lane reads the ASC key id into env, which is what its steps gate on');

// The invariant is about CREDENTIALS, not about the script's name, and saying
// it that way matters now that `ios-archive.sh` has two callers (row
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

// --- 9b. ci.yml ships the docs sibling it is contracted to ship --------
//
//`.ci-siblings` declares xchain-documentation, and a
// declared-but-absent sibling is a REFUSAL rather than a skip - so this
// workflow is the only thing standing between the release gate and 29 red
// smokes on every master commit. Each assertion below pins one thing that has
// to stay true for the docs-coupled smokes to actually RUN.
const testJob = ci.slice(ci.indexOf('\n  test:'), ci.indexOf('\n  build:'));

// The checkout itself, and it must be UNCONDITIONAL. It used to be gated on
// an XCHAIN_DOCS_READ_KEY deploy key because the docs repo was private; the
// repo is public now, so an anonymous checkout resolves it and a fork can run
// this workflow too. The gate is what actually broke: no such secret was ever
// set on this repo, so the step never ran and 29 smokes failed with the
// sibling reported unreachable. A condition that is never met and a missing
// checkout are the same outcome, which is the failure this block exists to
// catch, so re-gating this step needs a credential that demonstrably exists.
assert.ok(/repository:\s*XChain-Platform\/xchain-documentation/.test(testJob),
    'the sibling checkout must name XChain-Platform/xchain-documentation');
assert.ok(!/if:\s*env\.XCHAIN_DOCS_READ_KEY/.test(testJob),
    'the sibling checkout must not be gated on XCHAIN_DOCS_READ_KEY: that secret does '
    + 'not exist on this repo, so the gate silently skipped the checkout and every '
    + 'docs-coupled smoke refused. xchain-documentation is public; no credential is needed.');
assert.ok(!/ssh-key:/.test(testJob),
    'the sibling checkout reads a PUBLIC repo and needs no credential; an ssh-key here '
    + 'reintroduces a secret the repo does not hold.');

// The path is not cosmetic: _docs-repo.js resolves the sibling from its own
// location, never from cwd, and actions/checkout refuses any path outside
// the workspace. XCHAIN_DOCS_ROOT is what reconciles the two, so the pair
// must agree or the checkout lands somewhere nothing reads.
assert.ok(/path:\s*\.docs-sibling/.test(testJob),
    'the sibling must be checked out to .docs-sibling');
assert.ok(/^\s{6}XCHAIN_DOCS_ROOT:\s*\$\{\{\s*github\.workspace\s*\}\}\/\.docs-sibling/m.test(testJob),
    'XCHAIN_DOCS_ROOT must point at the same .docs-sibling path the checkout writes; '
    + 'if the two ever disagree the checkout succeeds and every docs smoke still refuses.');

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

//. §6 step 1 says a release tag is pinned to a commit that green
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

console.log('OK: release CI smoke (S4: trigger surface, environment gate, no K1 on runners, no auto-publish,'
    + 'the §6 step-1 validated-commit gate, and every SPA-building workflow raises the Node heap '
    + 'ceiling that killed all three mobile.yml runs)');
