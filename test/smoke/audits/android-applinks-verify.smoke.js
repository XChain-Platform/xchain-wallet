// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: the App Links verdict is a REPEATABLE check, and it refuses
// every venue whose answer would not mean what it says.
//
// WHAT THIS IS DEFENDING. App Links fail silently - an install whose
// certificate is not published in `https://xchain.io/.well-known/assetlinks.json`
// simply opens every `xchain.io` link in the browser, forever, with nothing
// logged anywhere. So the only thing that settles it is Android's own
// verifier, and three separate venue facts each LOOK like that verifier's
// answer and are not:
//
//   `none` on a google_apis image   The agent is on the image (other
//                                   packages read `verified`) and is never
//                                   invoked for a sideloaded package. `none`
//                                   is the ABSENCE of a verdict; read as a
//                                   failure it sends somebody to re-deploy
//                                   an assetlinks.json that was already right.
//   `always` on API 30              `pm get-app-links` does not exist below
//                                   API 31, and the near-miss SINGULAR
//                                   `pm get-app-link` returns a user
//                                   PREFERENCE from the same-shaped output.
//                                   Recording that as `verified` is exactly
//                                   the error that invalidated this project's
//                                   first measurement.
//   a cached `verified`             A verdict that survives the device going
//                                   offline measures a cache, not the file.
//
// Every one of those is driven here against FAKE `adb` / `sdkmanager` /
// `avdmanager` / `emulator` shims: no SDK, no emulator, no network, so the
// decision table is checked on every `pnpm test:smoke` rather than on the
// days somebody has an AVD booted.
//
// Coverage:
//
//    1. `--help` answers; an unknown flag is REFUSED, never consumed.
//    2. A non-playstore image string is refused before any tool is run.
//    3. An AVD created from `google_apis` is refused by its config.ini, and
//       the refusal names the way that image lies (`none` forever).
//    4. `PlayStore.enabled=no` is NOT a refusal: the real xc36play reads
//       exactly that and verifies fine.
//    5. API 30 is refused, naming the singular-command trap.
//    6. No `com.android.vending` is refused.
//    7. The happy path passes, and resets the verdict BEFORE polling.
//    8. A permanent `none` exits 4 and is never reported as pass or fail.
//    9. `1024` and a stated failure exit 5, with different remedies.
//   10. The `User N:` section can never be read as the verdict.
//   11. `--falsify` requires the verdict to change offline, and refuses a
//       `verified` that survives being offline (exit 7).
//   12. `--json` emits one machine-readable line.
//   13. Provisioning installs the image and creates the AVD once.
//   14. The defaults are the repo's own facts (applicationId, domain), so a
//       rename cannot leave this checking a package that no longer ships.
//   15. The tool is in the release README's inventory.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const SCRIPT = join(wsRoot, 'tools', 'release', 'android-applinks-verify.sh');

const checks = [];
function check(name, fn) { checks.push([name, fn]); }

const scratchDirs = [];

// ------------------------------------------------------------ the shims
//
// Each shim is a real program on disk that answers the exact invocations the
// script makes, out of files in a state directory. Nothing here mocks the
// script's own logic: it runs unmodified, and only the world is fake.

const ADB_SHIM = String.raw`#!/usr/bin/env bash
D="$FAKE_DIR"
echo "$*" >> "$D/adb.log"
[ "$1" = "-s" ] && shift 2
case "$1" in
    get-state) cat "$D/get-state" 2>/dev/null || echo device; exit 0 ;;
    emu)       exit 0 ;;
    install)   echo "install $*" >> "$D/adb.log"; exit "$(cat "$D/install-exit" 2>/dev/null || echo 0)" ;;
    shell)     shift ;;
    *)         exit 0 ;;
esac
case "$*" in
    "getprop sys.boot_completed")   echo 1; exit 0 ;;
    "getprop ro.build.version.sdk") cat "$D/sdk" 2>/dev/null || echo 36; exit 0 ;;
    "pm path com.android.vending")
        [ -f "$D/no-vending" ] && exit 1
        echo "package:/system/priv-app/Phonesky/Phonesky.apk"; exit 0 ;;
    "svc wifi disable"|"svc data disable") touch "$D/offline"; exit 0 ;;
    "svc wifi enable"|"svc data enable")   rm -f "$D/offline"; exit 0 ;;
    "pm set-app-links"*|"pm verify-app-links"*) exit 0 ;;
    "pm get-app-links "*) ;;
    *) exit 0 ;;
esac

# The state queue: one line per get-app-links call, last line repeating.
queue="$D/states"
[ -f "$D/offline" ] && [ -f "$D/states-offline" ] && queue="$D/states-offline"
echo x >> "$D/gal.count"
n="$(wc -l < "$D/gal.count" | tr -d ' ')"
total="$(wc -l < "$queue" | tr -d ' ')"
[ "$n" -gt "$total" ] && n="$total"
state="$(head -n "$n" "$queue" | tail -n 1)"

if [ "$state" = "UNKNOWN" ]; then
    echo "Unknown command: get-app-links"
    exit 0
fi

# The state "absent" means the domain is not in the verification section at
# all, while the USER section still names it - which is how an unscoped
# reader picks up a link-handling preference and reports it as a verdict.
verline="      xchain.io: $state"
[ "$state" = "absent" ] && verline="      example.com: none"

cat <<EOF
io.xchain.wallet.android:
    ID: 6c9c6a8d-0000-4000-8000-000000000000
    Signatures: [4B:5D:E0:91:CF:39:97:31:06:11:B8:46:8B:67:79:DC:72:F5:8A:2A:94:0E:53:4F:1E:0A:59:AD:D8:25:9E:28]
    Domain verification state:
$verline
    User 0:
      Verification link handling allowed: true
      Selection state:
        Enabled:
          xchain.io: always
EOF
exit 0
`;

const SDKMANAGER_SHIM = String.raw`#!/usr/bin/env bash
echo "$*" >> "$FAKE_DIR/sdkmanager.log"
exit 0
`;

// `list avd` names whatever the state dir says exists; `create avd` records
// the flags it was given and writes the config.ini the script then reads.
const AVDMANAGER_SHIM = String.raw`#!/usr/bin/env bash
D="$FAKE_DIR"
echo "$*" >> "$D/avdmanager.log"
if [ "$1" = "list" ]; then
    if [ -f "$D/avd-exists" ]; then
        echo "Available Android Virtual Devices:"
        echo "    Name: $(cat "$D/avd-exists")"
    fi
    exit 0
fi
if [ "$1" = "create" ]; then
    name=""; tag="google_apis_playstore"
    while [ $# -gt 0 ]; do
        case "$1" in
            -n) name="$2"; shift 2 ;;
            -k) case "$2" in *google_apis_playstore*) tag=google_apis_playstore ;; *) tag=google_apis ;; esac; shift 2 ;;
            *)  shift ;;
        esac
    done
    mkdir -p "$D/avd/$name.avd"
    {
        echo "AvdId=$name"
        echo "PlayStore.enabled=no"
        echo "abi.type=arm64-v8a"
        echo "image.sysdir.1=system-images/android-36/$tag/arm64-v8a/"
        echo "tag.id=$tag"
    } > "$D/avd/$name.avd/config.ini"
    exit 0
fi
exit 0
`;

const EMULATOR_SHIM = String.raw`#!/usr/bin/env bash
echo "$*" >> "$FAKE_DIR/emulator.log"
exit 0
`;

const APKSIGNER_SHIM = String.raw`#!/usr/bin/env bash
echo "Signer #1 certificate SHA-256 digest: 4b5de091cf39973106"
exit 0
`;

function shim(dir, name, body) {
    const p = join(dir, name);
    writeFileSync(p, body);
    chmodSync(p, 0o755);
    return p;
}

/**
 * Build a fake world. `states` is the queue `pm get-app-links` walks, one
 * entry per call, the last entry repeating forever.
 */
function world({
    states = ['verified'],
    statesOffline = null,
    sdk = '36',
    vending = true,
    avdExists = 'xc36play',
    avdTag = 'google_apis_playstore',
    playStoreEnabled = 'no',
    attached = true,
} = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'xc1420-applinks-'));
    scratchDirs.push(dir);
    const bin = join(dir, 'bin');
    mkdirSync(bin);

    shim(bin, 'adb', ADB_SHIM);
    shim(bin, 'sdkmanager', SDKMANAGER_SHIM);
    shim(bin, 'avdmanager', AVDMANAGER_SHIM);
    shim(bin, 'emulator', EMULATOR_SHIM);
    shim(bin, 'apksigner', APKSIGNER_SHIM);

    writeFileSync(join(dir, 'states'), `${states.join('\n')}\n`);
    if (statesOffline) writeFileSync(join(dir, 'states-offline'), `${statesOffline.join('\n')}\n`);
    writeFileSync(join(dir, 'sdk'), `${sdk}\n`);
    writeFileSync(join(dir, 'get-state'), attached ? 'device\n' : 'unknown\n');
    if (!vending) writeFileSync(join(dir, 'no-vending'), '');
    if (avdExists) writeFileSync(join(dir, 'avd-exists'), avdExists);

    // The AVD the script will read. Written even when `avdExists` is false so
    // a create-path run has somewhere to land; the shim overwrites it.
    if (avdExists) {
        const avdDir = join(dir, 'avd', `${avdExists}.avd`);
        mkdirSync(avdDir, { recursive: true });
        writeFileSync(join(avdDir, 'config.ini'), [
            `AvdId=${avdExists}`,
            `PlayStore.enabled=${playStoreEnabled}`,
            'abi.type=arm64-v8a',
            `image.sysdir.1=system-images/android-36/${avdTag}/arm64-v8a/`,
            `tag.id=${avdTag}`,
            '',
        ].join('\n'));
    }

    const apk = join(dir, 'xchain-wallet-v0.339.0.apk');
    writeFileSync(apk, 'not really an apk');

    return { dir, bin, apk };
}

function run(w, args = [], extraEnv = {}) {
    const env = {
        ...process.env,
        FAKE_DIR: w.dir,
        JAVA_HOME: w.dir,
        XCHAIN_ADB: join(w.bin, 'adb'),
        XCHAIN_SDKMANAGER: join(w.bin, 'sdkmanager'),
        XCHAIN_AVDMANAGER: join(w.bin, 'avdmanager'),
        XCHAIN_EMULATOR: join(w.bin, 'emulator'),
        XCHAIN_APKSIGNER: join(w.bin, 'apksigner'),
        XCHAIN_AVD_HOME: join(w.dir, 'avd'),
        XCHAIN_APPLINKS_APK: w.apk,
        XCHAIN_APPLINKS_TIMEOUT: '3',
        XCHAIN_APPLINKS_POLL: '1',
        XCHAIN_APPLINKS_BOOT_TIMEOUT: '5',
        ...extraEnv,
    };
    const r = spawnSync('bash', [SCRIPT, ...args], { env, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const read = (rel) => readFileSync(join(wsRoot, rel), 'utf8');
const log = (w, name) => (existsSync(join(w.dir, name)) ? readFileSync(join(w.dir, name), 'utf8') : '');

// ----------------------------------------------------------------- checks

check('1. --help answers, and an unknown flag is refused rather than consumed', () => {
    const w = world();
    const help = run(w, ['--help']);
    assert.equal(help.code, 0, help.out);
    assert.match(help.out, /android-applinks-verify\.sh/);
    assert.match(help.out, /--falsify/);
    // The manual step has to be named where an operator reads, or the next
    // session re-derives it: only a real Play delivery carries the current key.
    assert.match(help.out, /Play delivery|tester account/i);

    // A typo'd flag must not become the thing the script measures. The sibling
    // preflight in this directory took `--help` as its one positional and
    // exited 0, which every caller read as a help screen.
    const bogus = run(w, ['--verify-everything']);
    assert.equal(bogus.code, 2, bogus.out);
    assert.match(bogus.out, /unknown argument/);
    assert.equal(log(w, 'adb.log'), '', 'a refused flag still ran adb');
});

check('2. a non-playstore image string is refused before any tool runs', () => {
    const w = world();
    const { code, out } = run(w, [], {
        XCHAIN_APPLINKS_IMAGE: 'system-images;android-36;google_apis;arm64-v8a',
    });
    assert.equal(code, 3, out);
    assert.match(out, /google_apis_playstore/);
    assert.match(out, /ABSENCE of a verdict/);
    assert.equal(log(w, 'sdkmanager.log'), '', 'it started installing before refusing');
    assert.equal(log(w, 'adb.log'), '', 'it talked to a device before refusing');
});

check('3. an AVD created from a google_apis image is refused on its config.ini', () => {
    // The image STRING can be right while the AVD of that name is not: this
    // AVD predates the check, or was created from the other image once.
    const w = world({ avdTag: 'google_apis' });
    const { code, out } = run(w);
    assert.equal(code, 3, out);
    assert.match(out, /google_apis/);
    assert.match(out, /never leaves 'none'/);
    // A refusal with no route out is a wall.
    assert.match(out, /delete avd -n xc36play/);
});

check('4. PlayStore.enabled=no on a Play image is NOT a refusal', () => {
    // The real xc36play reads exactly this (the pixel_6 profile is not
    // Play-capable) and verifies fine. Keying the check on that field instead
    // of tag.id would refuse the one venue that works.
    const w = world({ playStoreEnabled: 'no', states: ['verified'] });
    const { code, out } = run(w);
    assert.equal(code, 0, out);
    assert.match(out, /PASS/);
});

check('5. API 30 is refused, and the refusal names the singular-command trap', () => {
    const w = world({ sdk: '30' });
    const { code, out } = run(w);
    assert.equal(code, 3, out);
    assert.match(out, /API 30/);
    assert.match(out, /API 31\+/);
    assert.match(out, /pm get-app-link\b/);
    assert.match(out, /always\/ask\/never\/undefined/);
});

check('6. an image with no Play Store is refused after the device check', () => {
    const w = world({ vending: false });
    const { code, out } = run(w);
    assert.equal(code, 3, out);
    assert.match(out, /com\.android\.vending/);
    assert.match(out, /never invoked for a sideloaded package/);
});

check('7. the happy path passes, and RESETS the verdict before polling', () => {
    const w = world({ states: ['none', 'none', 'verified'] });
    const { code, out } = run(w);
    assert.equal(code, 0, out);
    assert.match(out, /xchain\.io: verified/);
    assert.match(out, /PASS/);
    // Which certificate was measured is half the result.
    assert.match(out, /signer certificate SHA-256/);
    assert.match(out, /4b5de091cf39973106/);

    const adb = log(w, 'adb.log');
    const resetAt = adb.indexOf('pm set-app-links');
    const reverifyAt = adb.indexOf('pm verify-app-links');
    const firstRead = adb.indexOf('pm get-app-links');
    assert.ok(resetAt >= 0 && reverifyAt >= 0, `no reset in the adb log:\n${adb}`);
    assert.ok(
        resetAt < firstRead && reverifyAt < firstRead,
        'the verdict was read BEFORE it was reset, so the run re-read a cached answer '
        + 'instead of measuring anything that happened today',
    );
    assert.match(adb, /install /, 'the artifact was never installed');
});

check('8. a permanent `none` exits 4 and is reported as neither pass nor fail', () => {
    const w = world({ states: ['none'] });
    const { code, out } = run(w);
    assert.equal(code, 4, out);
    assert.match(out, /NO VERDICT/);
    assert.match(out, /ABSENCE of a verdict/);
    assert.match(out, /Do not record this either way/);
    assert.doesNotMatch(out, /PASS/);
    // It must not be reported as a failing verdict either.
    assert.doesNotMatch(out, /NOT VERIFIED/);
});

check('9. 1024 and a stated failure exit 5, with the remedy each one needs', () => {
    const agentError = run(world({ states: ['1024'] }));
    assert.equal(agentError.code, 5, agentError.out);
    assert.match(agentError.out, /1024/);
    assert.match(agentError.out, /STATE_FIRST_VERIFIER_DEFINED/);
    assert.match(agentError.out, /could not fetch/);

    const stated = run(world({ states: ['legacy_failure'] }));
    assert.equal(stated.code, 5, stated.out);
    assert.match(stated.out, /NOT VERIFIED/);
    assert.match(stated.out, /sha256_cert_fingerprints/);
});

check('10. the User N: section can never be read as the verdict', () => {
    // The shim's output carries `xchain.io: always` under `User 0:`, which is
    // the user's link-handling PREFERENCE, and in this scenario the domain is
    // absent from the verification section entirely. A reader that greps the
    // whole output for the domain finds the preference and reports it as a
    // verdict - the same class of error that put a `verified` in this
    // project's record against a key Google had already rotated away from.
    const w = world({ states: ['absent'] });
    const { code, out } = run(w);
    assert.equal(code, 4, `expected NO VERDICT, got ${code}:\n${out}`);
    assert.doesNotMatch(out, /always/);
    assert.doesNotMatch(out, /PASS/);

    // And the ordinary case, where the section holds `none` and the user
    // block holds a preference, is still no-verdict rather than a pass.
    const ordinary = run(world({ states: ['none'] }));
    assert.equal(ordinary.code, 4, ordinary.out);
});

check('11. --falsify demands the verdict change offline, and refuses one that does not', () => {
    // Contingent: verified online, the agent's error state offline, verified
    // again when the network comes back. That is the shape run 25 measured.
    const good = world({ states: ['verified'], statesOffline: ['1024'] });
    const r1 = run(good, ['--falsify']);
    assert.equal(r1.code, 0, r1.out);
    assert.match(r1.out, /offline verdict: 1024/);
    assert.match(r1.out, /verdict is contingent/);
    const adb = log(good, 'adb.log');
    assert.match(adb, /svc wifi disable/);
    assert.match(adb, /svc wifi enable/, 'the device was left offline');

    // Not contingent: a cached `verified` that survives the device going
    // offline is measuring a cache, not the published file.
    const cached = world({ states: ['verified'], statesOffline: ['verified'] });
    const r2 = run(cached, ['--falsify']);
    assert.equal(r2.code, 7, r2.out);
    assert.match(r2.out, /NOT CONTINGENT/);
    assert.match(r2.out, /measures a cache/);
    assert.match(log(cached, 'adb.log'), /svc wifi enable/, 'the device was left offline');
});

check('12. --json emits one machine-readable line', () => {
    const w = world({ states: ['verified'] });
    const { code, out } = run(w, ['--json']);
    assert.equal(code, 0, out);
    const line = out.split('\n').find((l) => l.trim().startsWith('{'));
    assert.ok(line, `no JSON line in:\n${out}`);
    const parsed = JSON.parse(line);
    assert.equal(parsed.package, 'io.xchain.wallet.android');
    assert.equal(parsed.domain, 'xchain.io');
    assert.equal(parsed.state, 'verified');
    assert.equal(parsed.verdict, 'verified');

    const bad = run(world({ states: ['none'] }), ['--json']);
    assert.equal(bad.code, 4);
    const badLine = bad.out.split('\n').find((l) => l.trim().startsWith('{'));
    assert.equal(JSON.parse(badLine).verdict, 'no-verdict');
});

check('13. provisioning installs the image and creates the AVD exactly once', () => {
    const fresh = world({ avdExists: null, states: ['verified'], attached: false });
    const r1 = run(fresh);
    assert.equal(r1.code, 0, r1.out);
    assert.match(log(fresh, 'sdkmanager.log'), /--install system-images;android-36;google_apis_playstore;arm64-v8a/);
    const created = log(fresh, 'avdmanager.log');
    assert.match(created, /create avd -n xc36play/);
    assert.match(created, /-k system-images;android-36;google_apis_playstore;arm64-v8a/);
    assert.match(created, /-d pixel_6/);
    assert.match(log(fresh, 'emulator.log'), /-avd xc36play/);

    // An existing AVD is reused, not recreated: recreating it would wipe an
    // install the operator may be measuring on purpose. An emulator that is
    // already attached is likewise not booted a second time - a second one
    // takes the next port and the run then measures a different device than
    // the operator is watching.
    const existing = world({ states: ['verified'] });
    const r2 = run(existing);
    assert.equal(r2.code, 0, r2.out);
    assert.doesNotMatch(log(existing, 'avdmanager.log'), /create avd/);
    assert.equal(log(existing, 'emulator.log'), '', 'it booted a second emulator over an attached one');

    // --no-provision touches none of it.
    const attached = world({ states: ['verified'] });
    const r3 = run(attached, ['--no-provision']);
    assert.equal(r3.code, 0, r3.out);
    assert.equal(log(attached, 'sdkmanager.log'), '');
    assert.equal(log(attached, 'emulator.log'), '');

    // --no-install measures the install that is already there, which is the
    // only way the Play-delivered artifact can ever be measured.
    const played = world({ states: ['verified'] });
    const r4 = run(played, ['--no-provision', '--no-install']);
    assert.equal(r4.code, 0, r4.out);
    assert.doesNotMatch(log(played, 'adb.log'), /install /);
});

check('14. the defaults are the repo`s own facts, not a pasted copy', () => {
    const script = read('tools/release/android-applinks-verify.sh');

    const gradle = read('packages/mobile/android/app/build.gradle');
    const appId = /applicationId\s+"([^"]+)"/.exec(gradle);
    assert.ok(appId, 'no applicationId in build.gradle');
    assert.ok(
        script.includes(`XCHAIN_APPLINKS_PACKAGE:-${appId[1]}`),
        `the check defaults to a package that build.gradle does not ship (${appId[1]})`,
    );

    const manifest = read('packages/mobile/android/app/src/main/AndroidManifest.xml');
    const host = /android:autoVerify="true"[\s\S]*?android:host="([^"]+)"/.exec(manifest);
    assert.ok(host, 'no auto-verified host in AndroidManifest.xml');
    assert.ok(
        script.includes(`XCHAIN_APPLINKS_DOMAIN:-${host[1]}`),
        `the check defaults to a domain the manifest does not auto-verify (${host[1]})`,
    );

    // The template is the shape of the published file, and its package name
    // is the third place this identity is written down.
    const template = JSON.parse(read('packages/mobile/assetlinks.template.json'));
    assert.equal(template[0].target.package_name, appId[1],
        'assetlinks.template.json names a different package than build.gradle');
});

check('15. the tool is in the release README inventory', () => {
    const readme = read('tools/release/README.md');
    assert.ok(
        readme.includes('`android-applinks-verify.sh`'),
        'tools/release/README.md does not name android-applinks-verify.sh; that table is the '
        + 'inventory an operator reads to find out what exists',
    );
    assert.match(readme, /google_apis_playstore/,
        'the README row does not name the image the check requires, which is the whole finding');
});

let failed = 0;
for (const [name, fn] of checks) {
    try {
        fn();
        console.log(`  ok   ${name}`);
    } catch (err) {
        failed += 1;
        console.error(`  FAIL ${name}`);
        console.error(`       ${err.message}`);
    }
}

for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });

if (failed) {
    console.error(`android-applinks-verify: ${failed} check(s) failed`);
    process.exit(1);
}
console.log('android-applinks-verify: all checks passed');
