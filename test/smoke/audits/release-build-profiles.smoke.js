// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Build profiles in the release manifest (; rails §3, §5).
//
// A build profile is WHICH FEATURE SET was compiled in. v1 has two:
// `default` (web, desktop, extension) and `store` (the mobile builds, which
// compile out the surfaces app-store review posture hides). Two artifacts of
// one tag can therefore hold different code, and before this the manifest -
// the record whose entire job is to prove what shipped - could not say which
// was which.
//
// This runs the REAL tools/release/lib.sh against a staged directory rather
// than asserting on their source, because every bug this found was a parsing
// bug that reading the code would not have shown: the first version of the
// header put a space-separated artifact list on one line per profile, which
// is unparseable the moment electron-builder names half the release
// "xchain-wallet-0.333.1-x64.dmg".
//
// The failure cases matter more than the happy path. A profile claim that
// silently disagrees with the artifact list is worse than no claim at all,
// so each way of breaking it is asserted to be caught, by message.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const lib = join(repo, 'tools', 'release', 'lib.sh');
const expected = join(repo, 'tools', 'release', 'expected-artifacts.txt');
const verify = join(repo, 'tools', 'release', 'verify.sh');

// A realistic release, names included: the desktop ones carry productName
// with a space, and the two mobile artifacts are the whole point.
//
// BOTH ARCHITECTURES OF EVERY DESKTOP LANE, and the names are
// electron-builder's real ones rather than approximations. This list used
// to be one arch (and had `-mac-arch` the wrong way round), which the gate
// accepted happily until the arch column landed - the same blind spot that
// let all six lanes ship one arch for real (§8). Note the x64
// AppImage carries NO arch token: that is electron-builder's default-arch
// rule, not an omission here, and lib.sh's classifier knows it.
const ARTIFACTS = [
    ['xchain-wallet-web-v0.333.1.tar.gz', 'default'],
    ['xchain-wallet-extension-v0.333.1.zip', 'default'],
    ['xchain-wallet-0.333.1-x64.dmg', 'default'],
    ['xchain-wallet-0.333.1-arm64.dmg', 'default'],
    ['xchain-wallet-0.333.1-x64-mac.zip', 'default'],
    ['xchain-wallet-0.333.1-arm64-mac.zip', 'default'],
    ['xchain-wallet-setup-0.333.1-x64.exe', 'default'],
    ['xchain-wallet-setup-0.333.1-arm64.exe', 'default'],
    ['xchain-wallet-0.333.1-x64-win.zip', 'default'],
    ['xchain-wallet-0.333.1-arm64-win.zip', 'default'],
    ['xchain-wallet-0.333.1-x86_64.AppImage', 'default'],
    ['xchain-wallet-0.333.1-arm64.AppImage', 'default'],
    ['xchain-wallet_0.333.1_amd64.deb', 'default'],
    ['xchain-wallet_0.333.1_arm64.deb', 'default'],
    ['xchain-wallet-android-v0.333.1.aab', 'store'],
    ['xchain-wallet-v0.333.1.apk', 'store'],
    ['xchain-wallet-ios-v0.333.1.ipa', 'store'],
];

const work = mkdtempSync(join(tmpdir(), 'xc1008-'));
const dir = join(work, 'v0.333.1');
mkdirSync(dir, { recursive: true });
for (const [name] of ARTIFACTS) writeFileSync(join(dir, name), `pretend ${name}\n`);

function bash(script, opts = {}) {
    return execFileSync('bash', ['-c', script], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...opts,
    });
}

// Returns { ok, out } instead of throwing, for the cases that must fail.
function bashResult(script) {
    try {
        return { ok: true, out: bash(script) };
    } catch (err) {
        return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
}

const manifest = join(dir, 'RELEASE_HASHES.txt');
const write = `source ${JSON.stringify(lib)}; `
    + `xr_check_expected ${JSON.stringify(dir)} ${JSON.stringify(expected)} && `
    + `xr_write_manifest ${JSON.stringify(dir)} v0.333.1 abc123 2026-08-01T07:00:00Z enforced `
    + JSON.stringify(expected);

// --- 1. The gate and the writer accept a real release ------------------

let res = bashResult(write);
assert.ok(res.ok, `the artifact-set gate + manifest writer must accept a full release:\n${res.out}`);

const text = readFileSync(manifest, 'utf8');
assert.match(text, /^# manifest-version: 2$/m, 'profile lines are what version 2 means');

// --- 2. Every artifact is on exactly one profile line, spaces and all ---

const profileLines = text.split('\n').filter((l) => l.startsWith('# profile '));
assert.equal(
    profileLines.length,
    ARTIFACTS.length,
    'one profile line per artifact; a list on one line cannot survive a name with spaces',
);
for (const [name, profile] of ARTIFACTS) {
    assert.ok(
        profileLines.includes(`# profile ${profile}: ./${name}`),
        `${name} must be declared as profile ${profile}`,
    );
}
// The direct APK is `store`, and that is a fact about what users get: it is
// built from the same AAB, so anything compiled out for review is missing
// from the direct download too (§6).
assert.ok(
    profileLines.includes('# profile store: ./xchain-wallet-v0.333.1.apk'),
    'the direct APK carries the store feature set, not the default one',
);

// --- 3. verify.sh accepts it, including one artifact at a time ----------

const verifyCmd = (extra = '') => `bash ${JSON.stringify(verify)} --input ${JSON.stringify(dir)}`
    + ` --no-sig --tag v0.333.1 ${extra}`;

res = bashResult(verifyCmd());
assert.ok(res.ok, `verify.sh must accept a well-formed profiled manifest:\n${res.out}`);
res = bashResult(verifyCmd('--artifact "xchain-wallet-0.333.1-x64.dmg"'));
assert.ok(res.ok, `single-artifact mode must still parse profile lines:\n${res.out}`);

// --- 4. Every way of breaking the claim is caught ----------------------

const good = text;
const breakages = [
    [
        'an artifact whose profile line was dropped',
        good.split('\n').filter((l) => l !== '# profile store: ./xchain-wallet-ios-v0.333.1.ipa').join('\n'),
        /belongs to no build profile/,
    ],
    [
        'a profile name nobody declared',
        good.replace('# profile store:', '# profile sotre:'),
        /undeclared build profile/,
    ],
    [
        'one artifact claimed by two profiles',
        good.replace(
            '# profile store: ./xchain-wallet-ios-v0.333.1.ipa',
            '# profile store: ./xchain-wallet-ios-v0.333.1.ipa\n# profile default: ./xchain-wallet-ios-v0.333.1.ipa',
        ),
        /claimed by more than one build profile/,
    ],
    [
        'a profile line for an artifact the manifest does not hash',
        `${good.trimEnd()}\n# profile store: ./xchain-wallet-ios-v0.333.2.ipa\n`,
        /which the manifest does not hash/,
    ],
    [
        'no profile lines at all, which is what a v1 manifest looks like',
        good.split('\n').filter((l) => !l.startsWith('# profile ')).join('\n'),
        /carries no profile lines/,
    ],
];

for (const [what, broken, pattern] of breakages) {
    writeFileSync(manifest, broken);
    res = bashResult(verifyCmd());
    assert.ok(!res.ok, `verify.sh must REFUSE ${what}`);
    assert.match(res.out, pattern, `and say why, for ${what}`);
}
writeFileSync(manifest, good);
res = bashResult(verifyCmd());
assert.ok(res.ok, 'and the restored manifest verifies again');

// --- 5. The declared set must name a profile for every glob ------------

const declared = readFileSync(expected, 'utf8');
const rows = declared.split('\n')
    .filter((l) => /^(required|optional)\s/.test(l))
    .map((l) => l.trim().split(/\s+/));
assert.ok(rows.length > 0, 'expected-artifacts.txt declares nothing');
for (const row of rows) {
    // FIVE columns since that signature class. Pinning the exact count
    // rather than a minimum is deliberate and is why this assertion earns
    // its keep: lib.sh parses the row as `status pattern profile arches
    // _rest`, so any sixth column would be swallowed silently, and a fifth
    // one was too until the signature gate started reading it.
    assert.equal(row.length, 5,
        'every declared artifact needs a profile, an arch column AND a signature '
        + `class: ${row.join(' ')}`);
    assert.ok(['default', 'store'].includes(row[2]), `unknown profile in: ${row.join(' ')}`);
    // '-' is the way to say "not arch-partitioned" out loud; an empty
    // column would silently restore the pre-arch-gate behaviour.
    assert.ok(row[3] === '-' || row[3].split(',').every(
        (t) => ['x64', 'arm64', 'armv7l', 'universal', 'multi'].includes(t),
    ), `unknown arch token in: ${row.join(' ')}`);
}

// A stale list is caught where it is written, not where it is used: the
// release that discovers a missing profile should be the one being declared,
// not the one already staged and waiting for a signature.
const staleList = join(work, 'expected-stale.txt');
// The trailing columns are matched explicitly (profile, arch, signature
// class) rather than with a lazy `.*`: this line is a MUTATION, and a
// mutation regex that silently stops matching turns the assertion below
// into one that always passes. That is exactly what happened when the
// signature class was added - the row stopped ending in `-`, the
// replacement became a no-op, and the gate was asserted to reject a file
// nobody had actually broken.
writeFileSync(staleList, declared.replace(
    /^(required\s+xchain-wallet-web-v\*\.tar\.gz)\s+default\s+-\s+none$/m, '$1'));
assert.notEqual(readFileSync(staleList, 'utf8'), declared,
    'the stale-list mutation must actually change the file');
res = bashResult(
    `source ${JSON.stringify(lib)}; xr_check_expected ${JSON.stringify(dir)} ${JSON.stringify(staleList)}`,
);
assert.ok(!res.ok, 'a declared artifact with no profile must fail the gate');
assert.match(res.out, /declares profile '<missing>'/, 'and name the row that is stale');

// Two globs that disagree about one artifact is refused rather than resolved
// by order: picking the first match would write a guess into a signed record.
const ambiguous = join(work, 'expected-ambiguous.txt');
writeFileSync(ambiguous, `${declared}\noptional  xchain-wallet-ios-v*.ipa            default\n`);
res = bashResult(
    `source ${JSON.stringify(lib)}; xr_write_manifest ${JSON.stringify(dir)} v0.333.1 abc123 `
    + `2026-08-01T07:00:00Z enforced ${JSON.stringify(ambiguous)}`,
);
assert.ok(!res.ok, 'an artifact matching two profiles must not be given one anyway');
assert.match(res.out, /matches globs declaring both/, 'and the message must name the conflict');

// --- 6. A label the build cannot earn is refused ------------------------
//
// Recording a profile is not producing one. Until the §2.3 compile-time
// flags exist, a `store` label in a signed record would be a FALSE claim: a
// verifier would read it as "the review-hidden surfaces are absent" from a
// build that still contains them. That is worse than saying nothing.

const statusFile = join(repo, 'tools', 'release', 'store-profile-status.txt');
const statusNow = readFileSync(statusFile, 'utf8');
const gate = (target) => bashResult(
    `source ${JSON.stringify(lib)}; xr_assert_store_profile_buildable `
    + `${JSON.stringify(target)} ${JSON.stringify(expected)}`,
);

if (statusNow.startsWith('IMPLEMENTED')) {
    // The gate has been lifted, which is a deliberate act with its own
    // evidence. Assert the shape of the claim rather than the refusal.
    assert.match(
        statusNow.split('\n')[0],
        /^IMPLEMENTED \S+/,
        'lifting the store-profile gate must name the item that built it',
    );
} else {
    const res6 = gate(dir);
    assert.ok(!res6.ok, 'a release staging mobile artifacts must not be signable yet');
    assert.match(res6.out, /store build profile is not implemented/, 'and must say why');
}

// A desktop-only release is unaffected, which is the only release anyone
// can actually cut today: the gate must not block the shells that work.
const desktopOnly = join(work, 'desktop-only');
mkdirSync(desktopOnly, { recursive: true });
for (const [name, profile] of ARTIFACTS) {
    if (profile === 'default') writeFileSync(join(desktopOnly, name), `pretend ${name}\n`);
}
assert.ok(gate(desktopOnly).ok, 'a release with no store-profile artifact is not gated');

// --- 7. The build side agrees with the release side --------------------
//
// The profile names now exist in two languages: `XR_PROFILES` in lib.sh, which
// writes them into the manifest, and `BUILD_PROFILES` in csp.js, which decides
// what a build actually contains. Two lists of the same names in two languages
// is exactly the drift spent a session reconciling, so they are
// checked against each other rather than trusted to stay in step.

const libProfiles = /XR_PROFILES=\(([^)]*)\)/.exec(readFileSync(lib, 'utf8'))?.[1]
    ?.trim().split(/\s+/) ?? [];
const { BUILD_PROFILES } = await import(
    pathToFileURL(join(repo, 'packages', 'web', 'src', 'csp.js')).href
);
assert.deepEqual(
    libProfiles,
    [...BUILD_PROFILES],
    'the release tooling and the build must mean the same thing by a profile name',
);

// The staging rule that makes the label truthful: `packages/mobile` compiles
// nothing, it copies `packages/web/dist` verbatim, so without this a `default`
// bundle could be wrapped in a store artifact and signed as `store`.
//
// The expected profile became a VARIABLE when a later change added a second direct
// APK at the `default` profile, so what is asserted here is the pair of
// properties that keep the guard honest once it is parameterised:
//   1. it refuses any MISMATCH, rather than accepting a set of profiles;
//   2. the variable DEFAULTS to `store`, so an unset environment can never
//      widen the gate - which is the only way a parameter is safe here.
// A disjunction (`!== 'store' && !== 'default'`) would satisfy a naive
// "still mentions store" check while re-opening the exact hole: a `default`
// bundle wrapped in an artifact the signed manifest labels `store`.
const mobileBuild = readFileSync(join(repo, 'packages', 'mobile', 'scripts', 'build.js'), 'utf8');
assert.match(
    mobileBuild,
    /releaseProfile\s*=\s*process\.env\.XCHAIN_MOBILE_RELEASE_PROFILE\s*\|\|\s*'store'/,
    'the expected release profile must default to `store` when nothing sets it',
);
assert.match(
    mobileBuild,
    /releaseTag && stagedProfile !== releaseProfile/,
    'a release build must refuse to stage a bundle whose profile is not the expected one',
);
assert.ok(
    !/stagedProfile !== '\w+' &&\s*stagedProfile !== '\w+'/.test(mobileBuild),
    'and must refuse on mismatch, not accept a SET of profiles: a disjunction here '
    + 'lets a `default` bundle ride inside an artifact the manifest labels `store`',
);
assert.match(
    mobileBuild,
    /process\.exit\(1\)/,
    'and refuse by exiting, not by warning',
);

// ---- The two direct APKs must not be able to wear each other's label ----
//
// puts a SECOND direct APK at the `default` profile beside the
// store-derived one, and the failure this guards was measured rather than
// imagined (2026-08-07, against this same function): while the store row's
// glob was the greedy `xchain-wallet-v*.apk`, a default-profile APK named
// the obvious way did NOT fail the gate. It resolved to `store`, silently,
// because both names matched one glob declaring one profile - so there was
// nothing ambiguous for `xr_profile_for` to report. A verifier reads `store`
// as "the review-hidden surfaces are absent" from the one build that still
// contains them, which is the false claim in a signed, append-only record
// that this whole mechanism exists to prevent.
//
// Driven against the REAL committed declaration, not a fixture: a fixture
// here would only re-ask the question the declaration is the answer to.
{
    const profileOf = (name) => bashResult(
        `source ${JSON.stringify(lib)}; `
        + `xr_profile_for ${JSON.stringify(name)} ${JSON.stringify(expected)}`,
    );

    const store = profileOf('xchain-wallet-v0.336.0.apk');
    assert.ok(store.ok && store.out.trim() === 'store',
        `the released store APK name must still resolve \`store\`: ${store.out}`);

    const full = profileOf('xchain-wallet-v0.336.0-full.apk');
    assert.ok(full.ok && full.out.trim() === 'default',
        `the full-feature APK name must resolve \`default\`: ${full.out}`);

    // The class, not just the instance. Any OTHER suffixed APK is a name
    // nobody planned, and the defect above WAS a name nobody planned being
    // silently given a meaning - so the answer has to be a refusal, never an
    // inherited profile.
    for (const stray of [
        'xchain-wallet-v0.336.0-default.apk',
        'xchain-wallet-v0.336.0-beta.apk',
    ]) {
        const r = profileOf(stray);
        assert.ok(!r.ok, `an undeclared APK name must fail shut, not inherit a profile: ${stray} -> ${r.out}`);
        assert.match(r.out, /no profile declared/,
            'and must say the list does not describe it');
    }

    // THE GENERAL FORM, so the next instance is caught by the gate instead
    // of by somebody noticing. The defect above was one glob quietly
    // answering for an artifact that belonged to another; nothing about it
    // was specific to APKs. Every declared row must own its own canonical
    // name: generate the plainest filename each glob describes and check
    // that the list still calls it that row's profile.
    //
    // This is deliberately weaker than proving the globs are pairwise
    // disjoint, which is not decidable from this file - and stronger than
    // it looks, because the pattern that steals a name is nearly always
    // the one that also matches its neighbour's ordinary release name.
    // All 15 rows pass as of 2026-08-07; the APK row did not before the
    // anchor above.
    const declared = readFileSync(expected, 'utf8').split('\n')
        .filter((l) => /^(required|optional)\s/.test(l))
        .map((l) => { const c = l.trim().split(/\s+/); return { glob: c[1], profile: c[2] }; });
    assert.ok(declared.length > 0, 'the declaration parsed to at least one row');
    for (const { glob, profile } of declared) {
        const name = glob.replace(/\[([^\]]+)\]/g, (_m, set) => set[0]).replace(/\*/g, '0.336.0');
        const r = profileOf(name);
        assert.ok(r.ok && r.out.trim() === profile,
            `the glob '${glob}' declares '${profile}', but the list resolves its own `
            + `canonical name '${name}' to '${r.ok ? r.out.trim() : 'a refusal'}' - `
            + 'some other row is answering for this one');
    }
}

rmSync(work, { recursive: true, force: true });

// ---- A store build does not ship its own sourcemaps (§5) ---------
//
// The web shell is HOSTED, so a sourcemap costs a fetch nobody makes unless
// DevTools is open. A mobile store build is not hosted: `cap sync` copies all
// of dist/ into the app bundle, so the maps are shipped, not offered.
// Measured on the iOS store build before this guard existed: 22 MB of .map in
// a 27 MB payload, each carrying `sourcesContent`, to serve a debugger that
// Release configurations disable outright (a later change pins isInspectable off).
//
// Both other shells had already decided this the other way, which is what
// makes it an inherited default rather than a posture: desktop and extension
// set sourcemap false. The mobile shells never decided anything - they bundle
// the web shell's output.
//
// Checked by RESOLVING each config rather than grepping it, because the value
// that matters is the one vite receives. The cache-buster is load-bearing: an
// ES module is evaluated once per specifier, and BUILD_PROFILE is read at
// module scope, so a second plain import would hand back the first profile's
// answer and the assertion would pass for the wrong reason.
const viteConfigFor = async (pkg, profile) => {
    const before = process.env.XCHAIN_BUILD_PROFILE;
    if (profile === undefined) delete process.env.XCHAIN_BUILD_PROFILE;
    else process.env.XCHAIN_BUILD_PROFILE = profile;
    const url = `${pathToFileURL(join(repo, 'packages', pkg, 'vite.config.js')).href}?profile=${profile ?? 'default'}`;
    try {
        return (await import(url)).default;
    } finally {
        if (before === undefined) delete process.env.XCHAIN_BUILD_PROFILE;
        else process.env.XCHAIN_BUILD_PROFILE = before;
    }
};

assert.equal(
    (await viteConfigFor('web', 'store')).build.sourcemap,
    false,
    'a `store` web bundle carries no sourcemaps: cap sync copies dist/ INTO the ipa and aab, '
    + 'so a map is shipped weight rather than an on-demand fetch, and no store build can use one',
);
assert.equal(
    (await viteConfigFor('web', undefined)).build.sourcemap,
    true,
    'the hosted web shell keeps its sourcemaps: this guard must pin the store profile alone, '
    + 'or the next person debugging production loses them and reverts the whole thing',
);
for (const pkg of ['desktop', 'extension']) {
    assert.equal(
        (await viteConfigFor(pkg, undefined)).build.sourcemap,
        false,
        `the ${pkg} shell ships no sourcemaps, which is the posture the store profile now matches`,
    );
}

console.log(
    'OK: release build-profile smoke (manifest-version 2 carries one'
    + ' `# profile <name>: <artifact>` line per artifact, written from the committed'
    + ' expected-artifacts.txt profile column; names with spaces survive the round trip;'
    + ' verify.sh refuses a dropped line, an undeclared profile name, a double claim, a'
    + ' claim it does not hash, and a manifest with no profile lines at all; the declared'
    + ' set must name a profile for every glob and must not declare two for one artifact;'
    + ' and sign.sh refuses to record a `store` label while the store build profile is'
    + ' unimplemented, without gating the desktop-only releases that are cuttable today.'
    + ' lib.sh and csp.js agree on the profile names, and a release build refuses'
    + ' to stage a web bundle that is not the store profile. §5: a `store` web'
    + ' bundle emits no sourcemaps, resolved from the config rather than grepped, while the'
    + ' hosted shell keeps them and desktop/extension stay as they were)',
);
