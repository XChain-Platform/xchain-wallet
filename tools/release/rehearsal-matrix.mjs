// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/rehearsal-matrix.mjs - the shipped update lanes, and what
// each one is smoked on ( §2, §7.5, DD4).
//
// WHAT A "LANE" IS HERE. Not an artifact and not a build lane: an
// OS/arch pair that receives updates, plus one artifact format
// electron-updater can actually swap in place on it. The dmg and the
// Windows zip are shipped install formats with NO auto-update path, so
// they are not lanes - a rehearsal of them would exercise nothing (§7.5).
//
// THE .deb IS A LANE, AND THIS FILE SAID IT WAS NOT (corrected 2026-08-02,
//  §5). The claim here, on the download page and in the spec was that
// "electron-updater's deb path needs privilege escalation at install time",
// so deb users get a notification and a manual link and nothing swaps. That
// is not what the pinned electron-updater does. Measured against the
// installed 6.8.9 and a real two-arch packaged build:
//
//   - `DebUpdater` exists and is a complete updater: it selects the `.deb`
//     out of the pointer, downloads it, and on install runs `dpkg -i`
//     through `pkexec` (or gksudo/kdesudo/sudo). The escalation is not a
//     missing feature, it is the install step, and it prompts the user.
//   - Which Linux updater a build gets is decided by `resources/package-type`,
//     a file the deb target writes into the packaged app. Our `.deb` ships
//     it, containing the literal string `deb` (verified with `dpkg-deb -c`
//     on the built artifact), so every deb install instantiates `DebUpdater`
//     rather than the AppImage one.
//   - Both `stable-linux.yml` and `stable-linux-arm64.yml` already list the
//     `.deb` next to the AppImage, so the feed has been serving the deb
//     update path all along.
//
// The consequence of believing otherwise was not a missing feature: it was
// that the ONE update path that ends in a root-privileged package install
// was the one path excluded from the staging rehearsal, from the staging
// build's target set, and from what we told users about being patched.
//
// THE TWO HALVES OF A LANE'S PROOF, and only one of them needs hardware:
//
//   selection + download + proof   Which artifact does an OS/arch pair
//                                  resolve out of the pointer, does it
//                                  download, does its hash match, and
//                                  does the K1-signed manifest cover it?
//                                  All of that is a property of the FEED
//                                  and is checked from anywhere. No
//                                  device needed - `rehearse.mjs run`
//                                  does every lane on one machine.
//
//   install + launch + swap        Whether the downloaded artifact
//                                  actually replaces the running app on
//                                  that OS/arch. This is the half that
//                                  needs the hardware in `device`.
//
// That split is worth stating because it moves DD4. DD4 asks what we
// smoke win-arm64 and linux-arm64 on, and specifically demands the
// UPDATE SELECTION check for win-arm64 (both Windows arches share one
// `stable.yml`, and upstream picks between them by substring-matching
// `process.arch` against the filename). Selection is the half that does
// not need an arm64 machine, so it is covered today, for every lane, by
// the probe. What is still blocked on DD4 is only the swap.
//
// `device: null` means DD4 has not been answered for that lane. Per the
// spec's own rule - "No named device for a lane = that lane does not
// ship" - `rehearse.mjs coverage` refuses to call such a lane launch-
// ready, and says so rather than passing quietly.
//
// DD4 IS NOW ANSWERED FOR ALL EIGHT LANES (the last two by operator
// decision 2026-08-03, ). No lane carries `device: null`, and
// `rehearsal.smoke.js` refuses a new one that does, rather than letting it
// inherit the old unanswered state silently.
//
// NAMING A DEVICE IS NOT A CLAIM THAT THE LANE HAS BEEN REHEARSED. It says
// only which machine the swap will be watched on. `coverage` still reports
// an un-rehearsed lane as ⬜ and still exits non-zero; naming changes only
// the REASON it gives, from "DD4 unanswered" to "never rehearsed". Those
// are different blockers with different owners and the output must not
// conflate them. What actually blocks a rehearsal now is K1.
//
// WHY A HOSTED RUNNER DOES NOT TAKE THE WINDOWS LANES, since it is the
// obvious idea and it was measured rather than dismissed . A
// `windows-latest` runner IS a free native x64 Windows machine, and the
// nsis lane has no elevation prompt to answer (`perMachine: false`, so no
// UAC, unlike the deb lane's pkexec). It still cannot do this job:
// `rehearse.mjs attest` requires `--by <who watched it>`, because whether
// the download replaced the running app is an OS-level fact no test in the
// process can observe. A CI job cannot be the witness without removing the
// witness. A runner could add an automated swap CHECK as separate evidence;
// it cannot produce an attestation.

/**
 * @typedef {Object} Lane
 * @property {string} id        stable identifier, used in records
 * @property {string} os        node platform: win32 | darwin | linux
 * @property {string} arch      process.arch value: x64 | arm64
 * @property {string} format    the update-capable artifact extension
 * @property {string|null} device  named smoke hardware (DD4), or null
 * @property {string} [note]
 */

/** @type {Lane[]} */
export const LANES = [
    {
        id: 'win-x64',
        os: 'win32',
        arch: 'x64',
        format: 'exe',
        device: 'Windows 11 in Parallels on the Mac Studio (x64 under Windows-on-ARM emulation)',
        note: 'nsis. Shares stable.yml with win-arm64, so selection is load-bearing. '
            + 'EMULATED SILICON, accepted by the operator 2026-08-03 : the '
            + 'installer, the launch and the update swap are all genuinely exercised, '
            + 'and only the CPU is not native. Said here because this string is what '
            + 'attest copies into the rehearsal record.',
    },
    {
        id: 'win-arm64',
        os: 'win32',
        arch: 'arm64',
        format: 'exe',
        device: 'Windows 11 ARM in Parallels on the Mac Studio (M3 Ultra, native arm64)',
        note: 'nsis. NATIVE, and the inversion is the point: this is the lane no cloud '
            + 'runner covers well, and the same VM that emulates x64 runs arm64 on real '
            + 'silicon. Selection out of the shared stable.yml is probed regardless.',
    },
    {
        id: 'mac-x64',
        os: 'darwin',
        arch: 'x64',
        format: 'zip',
        device: 'Mac Studio M3 Ultra, x64 build under Rosetta (not native silicon)',
        note: 'zip, never dmg: the dmg has no auto-update path. Shares stable-mac.yml.',
    },
    {
        id: 'mac-arm64',
        os: 'darwin',
        arch: 'arm64',
        format: 'zip',
        device: 'Mac Studio (release machine)',
        note: 'The one lane whose hardware the program already owns.',
    },
    {
        id: 'linux-x64-appimage',
        os: 'linux',
        arch: 'x64',
        format: 'AppImage',
        device: 'test-host.dankest.io (x86_64, Ubuntu 24.04)',
        note: 'Shares stable-linux.yml with the x64 deb, so format selection is load-bearing.',
    },
    {
        id: 'linux-arm64-appimage',
        os: 'linux',
        arch: 'arm64',
        format: 'AppImage',
        device: 'devhost (aarch64, Ubuntu 24.04)',
        note: 'Own pointer (stable-linux-arm64.yml); shares it with the arm64 deb.',
    },
    {
        id: 'linux-x64-deb',
        os: 'linux',
        arch: 'x64',
        format: 'deb',
        device: 'test-host.dankest.io (x86_64, Ubuntu 24.04)',
        note: 'DebUpdater. The only shipped update path that ends in a root install '
            + '(pkexec dpkg -i), and therefore the one that least deserved to be unrehearsed.',
    },
    {
        id: 'linux-arm64-deb',
        os: 'linux',
        arch: 'arm64',
        format: 'deb',
        device: 'devhost (aarch64, Ubuntu 24.04)',
        note: 'DebUpdater on arm64. Same pointer as the arm64 AppImage. The swap itself '
            + 'has been observed once, in a container, by drills/deb-update-swap.mjs.',
    },
];

/**
 * @typedef {Object} DirectLane
 * @property {string} id        stable identifier, used in records
 * @property {string} os        'android' (the only such lane today)
 * @property {string} arch      'universal': one APK serves every ABI
 * @property {string} format    the artifact a user installs by hand
 * @property {string} feed      the feed path, relative to the feed base
 * @property {string} client    the shipped module that reads that feed
 * @property {string|null} device  named smoke hardware (DD-A), or null
 * @property {string} [note]
 */

/**
 * The DIRECT lanes: install channels that receive update INFORMATION and
 * no installer .
 *
 * WHY THESE ARE NOT IN `LANES`. Everything above is an electron-updater
 * lane, and `probeLane` is written to that shape: a yml pointer, a
 * filename-matching selection rule, a download the app performs, a swap
 * the app performs. The direct APK has none of those. Its feed is a
 * one-field JSON document, it names no artifact, and nothing is ever
 * downloaded by the app. Folding it into `LANES` would either make every
 * desktop consumer special-case it or make `assertRecord` demand an
 * Android result of every desktop release, so it is a separate set with
 * its own probe (`probeDirectLane`) and its own gate.
 *
 * THAT SEPARATION IS EXACTLY HOW IT WENT UNREHEARSED. §7.5 was written
 * around electron-updater, so "the update lanes" meant `LANES`, and the
 * one shipped channel with a hand-rolled feed was not in the list that
 * the word "every" ranged over. `publish.sh` demanded a rehearsal record
 * of every production publish, which read as coverage; it was a desktop
 * gate standing in front of an Android feed it could not have probed.
 *
 * WHAT A DIRECT-LANE REHEARSAL IS, and it has three halves rather than
 * the desktop two:
 *
 *   feed + client      Does the published `latest.json` parse under the
 *                      SHIPPED parser, name this release, and drive the
 *                      SHIPPED client to the right answer in both
 *                      directions - silence for an install already on
 *                      this version, a notice naming it for an install
 *                      on the previous one? A property of the feed plus
 *                      the client bytes, so no device is needed.
 *
 *   destination        The notice tells a user to go and download the
 *                      APK. That APK has to exist beside the feed and be
 *                      covered by the K1-signed manifest for this tag,
 *                      or the notice is an instruction to nowhere. Also
 *                      feed-side.
 *
 *   install over       Whether the downloaded APK installs OVER the one
 *                      already on the device. This is the half that
 *                      needs hardware, and it is not the desktop swap
 *                      wearing a different hat: Android refuses an
 *                      update signed by a different key
 *                      (INSTALL_FAILED_UPDATE_INCOMPATIBLE), and the
 *                      only way out is an uninstall, which destroys the
 *                      vault. A key discontinuity is invisible to every
 *                      feed-side check here and is unrecoverable for the
 *                      user, which is why the hardware half is not
 *                      optional once a device exists to run it on.
 *
 * `device: null` means DD-A - which machine watches the install-over -
 * is unanswered, the Android analogue of DD4. `attest` refuses the lane
 * while it is null rather than accepting an unlocated claim, and
 * `assertRecord` says the swap half is unrehearsed IN THOSE WORDS rather
 * than passing quietly. Naming a device here is what arms the
 * requirement; nothing else has to change.
 */
/** @type {DirectLane[]} */
export const DIRECT_LANES = [
    {
        id: 'android-direct',
        os: 'android',
        arch: 'universal',
        format: 'apk',
        feed: 'android/latest.json',
        client: 'packages/web/src/update/directUpdateCheck.js',
        device: null,
        note: 'The sideloaded APK from downloads.xchain.io. A Play install of the same '
            + 'bytes updates itself and is deliberately NOT a lane: it is told nothing, '
            + 'which is what test/unit/mobile/directUpdateLane.test.js holds in place.',
    },
];

/** Every lane that receives updates, in either shape. */
export const ALL_LANES = [...LANES, ...DIRECT_LANES];

/**
 * The Linux artifact formats we ship, mapped to whether electron-updater
 * has an updater for them.
 *
 * WHY THIS IS DATA. The question "does this format auto-update?" was
 * answered once, from memory, in a comment, and stayed wrong through six
 * build stages and onto a public download page. It is answerable from the
 * installed package - `test/smoke/audits/linux-update-lanes.smoke.js`
 * checks this table against the classes electron-updater actually exports
 * and against LANES above, so a format that gains (or loses) an updater in
 * an upstream bump fails a test instead of quietly changing what users get.
 *
 * `rpm` and `pacman` are listed because upstream ships updaters for them:
 * they are not shipped formats today (§5 lists them as post-launch), and
 * the day one is added it must arrive as a lane, not as an extra row in
 * expected-artifacts.txt.
 */
export const LINUX_FORMAT_UPDATE_SUPPORT = {
    AppImage: { updater: 'AppImageUpdater', shipped: true, installStep: 'in-place swap of the running .AppImage' },
    deb: { updater: 'DebUpdater', shipped: true, installStep: 'pkexec/sudo dpkg -i, prompts for admin rights' },
    rpm: { updater: 'RpmUpdater', shipped: false, installStep: 'pkexec/sudo dnf/zypper/rpm install' },
    pacman: { updater: 'PacmanUpdater', shipped: false, installStep: 'pkexec/sudo pacman -U' },
};

/**
 * Source paths whose change raises the per-release rehearsal requirement
 * from "one OS" to "every OS" (§7.5: "on ALL OSes when the release
 * touches updater or vault/storage code").
 *
 * WHY THIS IS A LIST AND NOT A JUDGEMENT CALL. As written, the rule asks
 * the person cutting the release to decide whether their own change
 * counts as touching the updater - at the end of a release, under time
 * pressure, about their own work. Every incentive points at "no". A path
 * list is answerable by `git diff --name-only` and gets the same answer
 * from anyone.
 *
 * Deliberately broad: a false "all OSes" costs a rehearsal, a false "one
 * OS" ships an untested swap to two thirds of the fleet.
 */
export const ALL_OS_TRIGGER_PATHS = [
    'packages/desktop/main/updater.js',
    'packages/desktop/main/updateVerify.js',
    'packages/desktop/main/storage.js',
    'packages/desktop/main/keychain.js',
    'packages/desktop/electron-builder.config.cjs',
    'packages/core/src/storage/',
    'tools/release/',
];

/** @param {string} id */
export function laneById(id) {
    return ALL_LANES.find((l) => l.id === id) ?? null;
}

/** Is this lane one of the hand-rolled-feed lanes rather than an electron-updater one? */
export function isDirectLane(id) {
    return DIRECT_LANES.some((l) => l.id === id);
}

/** Lanes grouped by OS, for the "at least one OS" requirement. */
export function lanesByOs() {
    const out = new Map();
    for (const lane of LANES) {
        if (!out.has(lane.os)) out.set(lane.os, []);
        out.get(lane.os).push(lane);
    }
    return out;
}

// A DATA MODULE IS STILL A FILE AN OPERATOR CAN RUN . This one sits
// among ten executable tools in tools/release/, and `node rehearsal-matrix.mjs
// --help` printed NOTHING and exited 0 - indistinguishable, to a person and to
// a gate, from a help screen having been shown. The §13 check that covers this
// directory now demands real usage on stdout precisely because silence with a
// zero exit is the cheapest way to fake compliance.
//
// So direct invocation says what the module is and prints the matrix, which is
// the useful thing to see when you are deciding which lanes a release has to
// rehearse. It is read-only: no argument makes this file do work.
const USAGE = `rehearsal-matrix.mjs - the shipped update lanes, and what each one is
smoked on ( §2, §7.5, DD4;  for the direct lane).

Usage:
  node tools/release/rehearsal-matrix.mjs           # print the lane table
  node tools/release/rehearsal-matrix.mjs --json    # the same as JSON
  node tools/release/rehearsal-matrix.mjs --help

A DATA MODULE, not a command. It runs nothing and changes nothing; it is
imported by rehearse.mjs, by drills/deb-update-swap.mjs and by the smokes
that hold the table to what electron-updater actually exports. Printing is
the only thing it does when run.

Two kinds of lane, and they are rehearsed by different probes:

  LANES         an OS/arch pair that receives updates, plus one artifact
                format electron-updater can swap in place. The dmg and the
                Windows zip are shipped install formats with no auto-update
                path, so they are not lanes.

  DIRECT_LANES  an install channel that receives update INFORMATION and no
                installer: the sideloaded Android APK, whose latest.json
                feed the shipped client reads and whose install-over the
                user performs by hand.

Exports: LANES, DIRECT_LANES, ALL_LANES, LINUX_FORMAT_UPDATE_SUPPORT,
ALL_OS_TRIGGER_PATHS, laneById(id), isDirectLane(id), lanesByOs().
`;

if (process.argv[1] && process.argv[1].endsWith('rehearsal-matrix.mjs')) {
    const argv = process.argv.slice(2);
    if (argv.some((a) => a === '--help' || a === '-h')) {
        process.stdout.write(USAGE);
    } else if (argv.includes('--json')) {
        process.stdout.write(`${JSON.stringify(
            {
                lanes: LANES,
                directLanes: DIRECT_LANES,
                linuxFormats: LINUX_FORMAT_UPDATE_SUPPORT,
                allOsTriggerPaths: ALL_OS_TRIGGER_PATHS,
            },
            null,
            2,
        )}\n`);
    } else {
        const w = Math.max(...ALL_LANES.map((l) => l.id.length));
        const row = (lane) => process.stdout.write(
            `  ${lane.id.padEnd(w)}  ${lane.os}/${lane.arch} `
            + `${lane.format}  device: ${lane.device ?? 'none'}\n`,
        );
        process.stdout.write(`${LANES.length} electron-updater lanes ( §2)\n\n`);
        for (const lane of LANES) row(lane);
        process.stdout.write(`\n${DIRECT_LANES.length} direct lane(s), `
            + 'notice-only feed, install by hand \n\n');
        for (const lane of DIRECT_LANES) row(lane);
        process.stdout.write('\nRun with --help for what a lane is and what imports this.\n');
    }
}
