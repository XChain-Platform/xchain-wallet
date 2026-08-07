#!/usr/bin/env node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/verify-listing-assets.mjs - answers what the four Chrome Web
// Store listing assets SHOW, which is a different question from whether they
// exist at the sizes the store form accepts ( §5, row 42).
//
// WHY THIS EXISTS, AND WHAT IT WOULD HAVE CAUGHT. The listing-pack smoke
// re-reads every asset's pixel dimensions out of its PNG header, and the
// ceremony page states that check as though it settled the assets. It settles
// the address and says nothing about the contents: a 1280x800 screenshot of a
// product three versions old passes it perfectly. Measured on 2026-08-06, the
// four assets were captured at v0.333.1 (commit 438ba6d8, 2026-08-01) while
// the release staged for submission was v0.336.0, with 33 commits to the
// captured surfaces in between - among them a fix to the consent lines that
// render inside the sign-approval window, which is one of the three
// screenshots. Nothing in the repo could say so, because nothing recorded
// which build the assets were captured from.
//
// The store assigns a PERMANENT extension ID to the first upload and the
// screenshots are what a reviewer compares the product against, so "these
// images depict a build nobody can install" is a review finding waiting to
// happen, days into a review clock, on a listing that cannot be re-IDed.
//
// HOW IT ANSWERS IT. Only a capture run knows which tree it drove, so the
// capture script records it: packages/extension/scripts/capture-listing-
// screenshots.mjs calls writePin() at the end of a successful run and leaves
// docs/listing-assets/capture-pin.json holding the commit, the version, and
// each asset's sha256. This tool then compares that note against the tree:
//
//   1. the pin covers every asset and every asset's bytes still hash to what
//      the pin recorded - an asset swapped, re-cropped or hand-edited after
//      capture is caught here, and it is the half that is always checkable;
//   2. nothing has changed the surfaces an asset DEPICTS since the pinned
//      commit - the half that only matters at submission time.
//
// Same three-state vocabulary as store-version-monitor.mjs and
// verify-privacy-url.mjs, and for the same reason: a check that cannot tell
// must say so rather than fold into a pass or a failure.
//
//   exit 0  CLEAN         pin matches the bytes, no drift since capture
//   exit 1  STALE         a hash disagrees, or a depicted surface moved
//   exit 2  INCONCLUSIVE  no pin, no git history, or the pin is unreadable
//
// WHERE IT IS CHECKED FROM. The hash half is held by the listing-pack smoke,
// which runs everywhere. The drift half is NOT: it would go red on every UI
// commit until somebody recaptured, so it lives where the artifact actually
// matters, in the ceremony's Phase 5 step, the same placement row 31 chose
// for the monitor's own drift. Drift is only a defect at the moment the
// images are uploaded.
//
// CONFIGURATION
//
//   --since <ref>     compare the pinned commit against this ref instead of
//                     HEAD. Pass the release tag you are submitting
//                     (--since v0.336.0), which is the honest subject: the
//                     question is what the UPLOADED build looks like, not
//                     what your working tree looks like.
//   --write           (re)write the pin from the bytes on disk. Used by the
//                     capture script; also the bootstrap path for assets that
//                     predate this file.
//   --commit <sha>    with --write, the commit the capture ran against
//                     (default HEAD).
//   --how <how>       with --write, `capture` (a real capture run wrote this)
//                     or `derived` (reconstructed from git history). Default
//                     `capture`, since the capture script is the caller that
//                     matters.
//   --json            machine-readable result on stdout.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const ASSET_DIR = path.join(REPO_ROOT, 'packages/extension/docs/listing-assets');
const PIN_PATH = path.join(ASSET_DIR, 'capture-pin.json');
const MAS_ASSET_DIR = path.join(REPO_ROOT, 'packages/desktop/docs/listing-assets');

//  row 95: Apple's accepted macOS screenshot canvases. A listing image
// at any other size is refused by App Store Connect at upload, which is a slow
// and manual way to find out, so the capture asserts it as it writes and the
// verifier re-reads it from the PNG header rather than trusting the capture.
export const MAC_APP_STORE_SIZES = [
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
    { width: 2560, height: 1600 },
    { width: 2880, height: 1800 },
];

// Everything the three screenshots have in common: they are all the same React
// tree rendered in an extension window, over the demo dataset the capture
// script seeds. Listed once so the four entries below differ only where they
// really differ.
const SHELL = [
    'packages/core/src/shared',
    'packages/core/src/ui',
    'packages/core/src/flows/demoFixtures.js',
    'packages/extension/src/shared',
    'packages/extension/vite.config.js',
    'packages/extension/scripts/capture-listing-screenshots.mjs',
];

/**
 * The four assets, and the source each one DEPICTS. Exported because the
 * capture script writes the pin from this same list: one map, so the tool and
 * the capture cannot come to disagree about what an asset is.
 *
 * `depends` is derived from what the capture script actually drives - the
 * entry point each window loads (popup.html and sidepanel.html both mount
 * src/popup/main.jsx; approval.html mounts src/approval/main.jsx) plus, for
 * the approval window, the provider route the capture drives it through.
 */
export const ASSETS = [
    {
        name: 'screenshot-popup.png',
        shows: 'Toolbar popup, Home view',
        depends: [...SHELL, 'packages/extension/popup.html', 'packages/extension/src/popup'],
    },
    {
        name: 'screenshot-sidepanel.png',
        shows: 'Side panel, Tokens view',
        depends: [...SHELL, 'packages/extension/sidepanel.html', 'packages/extension/src/popup'],
    },
    {
        name: 'screenshot-sign-approval.png',
        shows: 'Sign-approval window (dApp message signature)',
        // The capture drives this one end to end from a fake dApp origin, so
        // the injected provider, the content script and the background broker
        // are all on screen in the sense that matters: a change to any of them
        // changes what the window says it is approving.
        depends: [
            ...SHELL,
            'packages/extension/approval.html',
            'packages/extension/src/approval',
            'packages/extension/src/content',
            'packages/extension/src/inject',
            'packages/extension/src/background',
            'packages/extension/src/background.js',
        ],
    },
    {
        name: 'promo-tile-440x280.png',
        shows: 'Brand logo and wordmark on the accent gradient',
        // No wallet UI at all: it is composited from the branding image and
        // the accent tokens, so UI churn legitimately does not stale it.
        depends: [
            'packages/core/src/branding/images/xchain-color-750.png',
            'packages/core/src/ui/tokens.css',
            'packages/extension/scripts/capture-listing-screenshots.mjs',
        ],
    },
];

/**
 * The Mac App Store listing images ( §13, frontier row 95).
 *
 * WHY A SECOND SET RATHER THAN A SECOND TOOL. Apple refuses a listing with no
 * screenshot exactly as Google and Chrome do, and until 2026-08-07 nothing in
 * this repo could produce or check a picture of the DESKTOP shell: this file
 * verified three named Chrome Web Store PNGs, and the only capture script was
 * the extension's. Copying either would have produced two implementations of
 * "which build do these images depict", which is the very drift the extension
 * set exists to catch, one level up. So the mechanism is shared and only the
 * data differs.
 *
 * Everything the desktop screenshots have in common: the same React tree the
 * other shells render, in an Electron window over the demo dataset, driven by
 * the desktop capture script.
 */
const DESKTOP_SHELL = [
    'packages/core/src/shared',
    'packages/core/src/ui',
    'packages/core/src/flows/demoFixtures.js',
    'packages/desktop/renderer',
    'packages/desktop/vite.config.js',
    'packages/desktop/scripts/capture-listing-screenshots.mjs',
];

export const MAS_ASSETS = [
    {
        name: 'screenshot-home.png',
        shows: 'Desktop window, Home view with the coin list',
        depends: [...DESKTOP_SHELL],
    },
    {
        name: 'screenshot-tokens.png',
        shows: 'Desktop window, Tokens view',
        depends: [...DESKTOP_SHELL],
    },
    {
        name: 'screenshot-settings.png',
        shows: 'Desktop window, Settings',
        // Deliberately this screen and not a prettier one: it is the screen
        // that was dead on desktop until row 105, and a listing image of it is
        // one more thing that cannot go quietly blank again.
        depends: [...DESKTOP_SHELL, 'packages/core/src/shared/components/settings'],
    },
];

/**
 * The sets this tool knows about. `extension` is the default everywhere, so
 * every caller that predates the Mac App Store lane keeps its behaviour.
 */
export const SETS = {
    extension: {
        id: 'extension',
        label: 'Chrome Web Store',
        dir: ASSET_DIR,
        pinPath: PIN_PATH,
        assets: ASSETS,
        capture: 'packages/extension/scripts/capture-listing-screenshots.mjs',
        // The Chrome Web Store canvases are fixed per asset and already held
        // by the listing-pack smoke, so there is no set-wide size rule here.
        sizes: null,
    },
    mas: {
        id: 'mas',
        label: 'Mac App Store',
        dir: MAS_ASSET_DIR,
        pinPath: path.join(MAS_ASSET_DIR, 'capture-pin.json'),
        assets: MAS_ASSETS,
        capture: 'packages/desktop/scripts/capture-listing-screenshots.mjs',
        sizes: MAC_APP_STORE_SIZES,
    },
};

/** @param {string | { id: string } | undefined} set */
function resolveSet(set) {
    if (!set) return SETS.extension;
    if (typeof set === 'object') return set;
    const found = SETS[set];
    if (!found) {
        throw new Error(`unknown listing-asset set '${set}'; known sets: ${Object.keys(SETS).join(', ')}`);
    }
    return found;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** PNG dimensions straight out of the IHDR, no image library needed. */
function pngSize(buf) {
    if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function git(args, opts = {}) {
    return execFileSync('git', args, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...opts,
    }).trim();
}

/**
 * Writes docs/listing-assets/capture-pin.json from the bytes currently on
 * disk. Exported so the capture script re-pins in the same run that produces
 * the images: a pin written by anything else is a claim about a capture
 * nobody watched.
 */
export function writePin({ commit, how = 'capture', version, set } = {}) {
    const target = resolveSet(set);
    const at = commit || git(['rev-parse', 'HEAD']);
    const full = git(['rev-parse', at]);
    // Read the version out of the pinned COMMIT, not out of the working tree.
    // They are the same thing for a live capture and they are not for a
    // bootstrap, where writing today's version beside a commit from five days
    // ago would be the exact kind of confident wrong number this file exists
    // to stop.
    const pkgVersion = version
        || JSON.parse(git(['show', `${full}:package.json`])).version;

    const assets = {};
    for (const asset of target.assets) {
        const file = path.join(target.dir, asset.name);
        const buf = fs.readFileSync(file);
        const size = pngSize(buf);
        assets[asset.name] = {
            sha256: sha256(buf),
            ...(size ? { width: size.width, height: size.height } : {}),
            shows: asset.shows,
        };
    }

    const pin = {
        _comment: 'Written by tools/release/verify-listing-assets.mjs (--write), normally from the '
            + `end of a successful ${target.capture} run. `
            + 'Records WHICH BUILD the store listing images depict, which their pixel dimensions '
            + 'cannot say. Do not hand-edit: a pin that was not written by a capture is a claim '
            + 'about a capture nobody watched.',
        set: target.id,
        capturedFrom: { commit: full, version: pkgVersion, how },
        observedAt: new Date().toISOString(),
        assets,
    };
    fs.writeFileSync(target.pinPath, `${JSON.stringify(pin, null, 4)}\n`);
    return pin;
}

/**
 * The pin-versus-bytes half, with NO git in it. Split out because this is the
 * half that is checkable everywhere and always: the listing-pack smoke calls
 * exactly this, so the gate and the ceremony tool run one implementation
 * rather than two that can drift. Returns { pin, hashProblems, extra } or a
 * `reason` when there is nothing to check against.
 */
export function verifyPin({ set } = {}) {
    const target = resolveSet(set);
    if (!fs.existsSync(target.pinPath)) {
        return {
            reason: `no capture pin at ${path.relative(REPO_ROOT, target.pinPath)}. Nothing records which `
                + 'build the listing images depict. Run the capture, or bootstrap the pin with '
                + '--write --how derived --commit <the commit the assets landed in>.',
        };
    }

    let pin;
    try {
        pin = JSON.parse(fs.readFileSync(target.pinPath, 'utf8'));
    } catch (err) {
        return { reason: `capture pin is not readable JSON: ${err.message}` };
    }
    if (!pin.capturedFrom || !pin.capturedFrom.commit || !pin.assets) {
        return { reason: 'capture pin is missing capturedFrom.commit or assets' };
    }

    const hashProblems = [];
    for (const asset of target.assets) {
        const recorded = pin.assets[asset.name];
        if (!recorded) {
            hashProblems.push(`${asset.name}: not covered by the pin at all`);
            continue;
        }
        const file = path.join(target.dir, asset.name);
        if (!fs.existsSync(file)) {
            hashProblems.push(`${asset.name}: pinned, but no such file`);
            continue;
        }
        const buf = fs.readFileSync(file);
        const actual = sha256(buf);
        if (actual !== recorded.sha256) {
            hashProblems.push(
                `${asset.name}: on disk ${actual.slice(0, 12)}..., pinned ${String(recorded.sha256).slice(0, 12)}...`,
            );
            continue;
        }
        // The pin also carries the dimensions it observed. They are checked
        // against the PNG header rather than trusted, because a hand-edited
        // pin is the one way this note can lie while every hash agrees.
        const size = pngSize(buf);
        if (recorded.width && size && (recorded.width !== size.width || recorded.height !== size.height)) {
            hashProblems.push(`${asset.name}: PNG header says ${size.width}x${size.height}, `
                + `pin says ${recorded.width}x${recorded.height}`);
            continue;
        }
        // A set-wide canvas rule, where the store has one. The Mac App Store
        // takes any of four sizes and refuses everything else at upload, so
        // the answer is worth having here rather than out of App Store Connect
        // at the end of a submission.
        if (target.sizes && size && !target.sizes.some((c) => c.width === size.width && c.height === size.height)) {
            hashProblems.push(`${asset.name}: ${size.width}x${size.height} is not one of the `
                + `${target.label}'s accepted canvases (`
                + `${target.sizes.map((c) => `${c.width}x${c.height}`).join(', ')})`);
        }
    }
    const extra = Object.keys(pin.assets).filter((n) => !target.assets.some((a) => a.name === n));
    return { pin, hashProblems, extra };
}

/**
 * The read-only whole: the pin half above, plus the drift half that needs git.
 */
export function verifyListingAssets({ since, set } = {}) {
    const assetSet = resolveSet(set);
    const pinned = verifyPin({ set: assetSet });
    if (pinned.reason) return { state: 'INCONCLUSIVE', reason: pinned.reason };
    const { pin, hashProblems, extra } = pinned;

    // Has anything an asset DEPICTS moved since it was captured?
    const target = since || 'HEAD';
    let targetSha;
    try {
        targetSha = git(['rev-parse', target]);
        git(['cat-file', '-e', `${pin.capturedFrom.commit}^{commit}`]);
    } catch (err) {
        return {
            state: 'INCONCLUSIVE',
            reason: `cannot resolve the capture commit ${pin.capturedFrom.commit} or ${target} in this `
                + `checkout (${String(err.message).split('\n')[0]}). A shallow clone or a missing tag `
                + 'reads as "no drift", which is why this is inconclusive rather than clean.',
            hashProblems,
        };
    }

    const drift = [];
    for (const asset of assetSet.assets) {
        const log = git([
            'log', '--oneline', '--no-decorate',
            `${pin.capturedFrom.commit}..${targetSha}`,
            '--', ...asset.depends,
        ]);
        const commits = log ? log.split('\n') : [];
        if (commits.length > 0) drift.push({ asset: asset.name, shows: asset.shows, commits });
    }

    const problems = hashProblems.length > 0 || drift.length > 0;
    return {
        state: problems ? 'STALE' : 'CLEAN',
        set: assetSet.id,
        pin: {
            commit: pin.capturedFrom.commit,
            version: pin.capturedFrom.version,
            how: pin.capturedFrom.how,
            observedAt: pin.observedAt,
        },
        target: { ref: target, commit: targetSha },
        hashProblems,
        extra,
        drift,
    };
}

const HELP = `Check that the Chrome Web Store listing assets depict the build being submitted.

Usage:
  node tools/release/verify-listing-assets.mjs [--since <ref>] [--json]
  node tools/release/verify-listing-assets.mjs --write [--commit <sha>] [--how capture|derived]

The listing-pack smoke already re-reads every asset's pixel dimensions. This
asks the other half of the question: WHICH BUILD the images show. It compares
packages/extension/docs/listing-assets/capture-pin.json against the bytes on
disk and against the commits that have touched the surfaces each asset
depicts.

  --since <ref>   compare against this ref instead of HEAD. At submission
                  time pass the release tag you are uploading.
  --write         (re)write the pin from the bytes on disk. The capture
                  script does this at the end of a successful run.
  --commit <sha>  with --write, the commit the capture ran against.
  --how <how>     with --write, capture (default) or derived.
  --json          machine-readable result on stdout.
  --set <id>      which listing to check: 'extension' (Chrome Web Store, the
                  default) or 'mas' (Mac App Store, the desktop shell).

Exit codes: 0 clean, 1 stale (a hash disagrees or a depicted surface moved),
2 inconclusive (no pin, or the history needed is not in this checkout).

Read-only unless --write is passed.`;

function main(argv) {
    if (argv.some((a) => a === '--help' || a === '-h')) {
        console.log(HELP);
        return 0;
    }
    const flag = (name) => {
        const i = argv.indexOf(name);
        return i === -1 ? undefined : argv[i + 1];
    };

    const set = flag('--set') || 'extension';

    if (argv.includes('--write')) {
        const pin = writePin({
            commit: flag('--commit'),
            how: flag('--how') || 'capture',
            set,
        });
        console.log(`[verify-listing-assets] pinned ${Object.keys(pin.assets).length} assets to `
            + `${pin.capturedFrom.commit.slice(0, 8)} (v${pin.capturedFrom.version}, how=${pin.capturedFrom.how})`);
        return 0;
    }

    const result = verifyListingAssets({ since: flag('--since'), set });
    if (argv.includes('--json')) {
        console.log(JSON.stringify(result, null, 2));
    } else if (result.state === 'INCONCLUSIVE') {
        console.error(`[verify-listing-assets] INCONCLUSIVE: ${result.reason}`);
    } else {
        const { pin, target } = result;
        console.log(`[verify-listing-assets] pin: ${pin.commit.slice(0, 8)} (v${pin.version}, `
            + `how=${pin.how}, observed ${pin.observedAt})`);
        console.log(`[verify-listing-assets] comparing against ${target.ref} (${target.commit.slice(0, 8)})`);
        for (const p of result.hashProblems) {
            console.error(`[verify-listing-assets] HASH: ${p}`);
        }
        for (const n of result.extra) {
            console.error(`[verify-listing-assets] the pin covers ${n}, which is not a listing asset`);
        }
        for (const d of result.drift) {
            console.error(`[verify-listing-assets] STALE: ${d.asset} (${d.shows}) - `
                + `${d.commits.length} commit(s) to what it depicts since it was captured:`);
            for (const c of d.commits.slice(0, 5)) console.error(`    ${c}`);
            if (d.commits.length > 5) console.error(`    ... and ${d.commits.length - 5} more`);
        }
        if (result.state === 'CLEAN') {
            console.log('[verify-listing-assets] CLEAN: every asset hashes to its pin and nothing it '
                + 'depicts has changed since it was captured');
        } else {
            console.error('[verify-listing-assets] STALE. Two honest ways out, and uploading anyway '
                + 'is neither: (1) rebuild the shell at the ref you are submitting and re-run '
                + `${SETS[result.set || 'extension'].capture}, which re-pins as it `
                + 'goes; or (2) read the commits above and record in the release record why none of '
                + 'them can change these pixels. This tool deliberately cannot tell a cosmetic '
                + 'commit from a visible one, so it names them rather than guessing. A reviewer '
                + 'compares these screenshots against the product they are sent, and the Chrome Web '
                + 'Store additionally assigns a permanent extension ID to the first upload.');
        }
    }
    return { CLEAN: 0, STALE: 1, INCONCLUSIVE: 2 }[result.state];
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    process.exit(main(process.argv.slice(2)));
}
