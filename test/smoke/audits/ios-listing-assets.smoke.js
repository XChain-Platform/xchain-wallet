// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the App Store listing images ( §6, frontier row 63).
//
// WHAT THIS IS DEFENDING, and it is not tidiness. On 2026-08-07 the eight
// images live on the iOS listing were found to depict a build 18 shared-UI
// commits older than the tag whose binary Apple holds; three of those commits
// changed what the captured scenes render. Nothing in the repo could say so,
// and the reason is worse than "no pin": `.gitignore` carried
// `/packages/mobile/screenshots`, so the images existed on exactly one disk,
// in no history, on any branch. The 18-commit measurement itself rested on
// file mtimes, which do not survive a copy.
//
// Apple's 2.3.3 accurate-metadata rule makes that a metadata-rejection class,
// days into a review clock. The mechanism that answers it already existed for
// the Chrome Web Store and the Mac App Store; this file holds the iOS set to
// the same standard, which is the part a gate can check anywhere:
//
//   1. the set exists, names a capture script, and covers BOTH idioms - a
//      universal app with no iPad screenshots cannot be submitted at all;
//   2. every asset is pinned, still hashes to what the pin recorded, and sits
//      on one of the two canvases App Store Connect accepts;
//   3. the images are TRACKED, which is the half that is specific to this
//      lane, because it is the half that was wrong.
//
// The drift half (has a depicted surface moved since the capture?) is NOT
// here, for the same reason the Chrome lane keeps it out: it would go red on
// every UI commit until somebody recaptured. It runs at ceremony time with
// `--set ios --since <the tag being submitted>`.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SETS, verifyPin, APP_STORE_SIZES } from '../../../tools/release/verify-listing-assets.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

const iosSet = SETS.ios;

// 1. The set, and both idioms in it.
assert.ok(
    existsSync(join(repoRoot, iosSet.capture)),
    `the App Store listing has no capture script at ${iosSet.capture}; hand-taken screenshots cannot be `
    + 're-cut at the ref being submitted, which is the whole reason the other two sets have one',
);

const idioms = new Set(iosSet.assets.map((a) => a.name.split('/')[0]));
assert.ok(
    idioms.has('iphone-17-pro-max') && idioms.has('ipad-pro-13-inch-m5'),
    'the App Store set must cover the iPhone AND the iPad idiom. A universal app with no iPad screenshots '
    + `is not merely thin, it cannot be submitted. Covered: ${[...idioms].join(', ')}`,
);
// Every scene in one idiom must exist in the other, or the listing is
// lopsided in a way no single-idiom check would notice.
const scenesOf = (dir) => iosSet.assets
    .filter((a) => a.name.startsWith(`${dir}/`))
    .map((a) => a.name.split('/')[1])
    .sort();
assert.deepEqual(
    scenesOf('iphone-17-pro-max'),
    scenesOf('ipad-pro-13-inch-m5'),
    'the two idioms depict different scenes; a scene added to one and forgotten in the other is a partial set',
);

// 2. Pinned, unaltered since capture, and on a canvas Apple takes.
const pin = verifyPin({ set: 'ios' });
assert.equal(
    pin.reason,
    undefined,
    `the App Store listing assets are not pinned to a build: ${pin.reason}. Run ${iosSet.capture}, which `
    + 'captures both idioms in one command, then pin what it produced.',
);
assert.deepEqual(
    pin.hashProblems,
    [],
    'the App Store listing assets disagree with their capture pin, or sit at a canvas App Store Connect '
    + `refuses (accepted: ${APP_STORE_SIZES.map((c) => `${c.width}x${c.height}`).join(', ')}): `
    + `${pin.hashProblems.join(' | ')}`,
);
assert.deepEqual(
    pin.extra,
    [],
    `the App Store pin covers files that are not listing assets: ${pin.extra.join(', ')}`,
);

// 3. TRACKED. This is the row-63 half, and it is asserted against git rather
// than against the filesystem on purpose: the images were present on disk the
// whole time they were missing from history, which is exactly why nobody
// noticed. `git ls-files` answers the question the disk cannot.
const tracked = new Set(
    execFileSync('git', ['ls-files', 'packages/mobile/screenshots'], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean),
);
for (const asset of iosSet.assets) {
    assert.ok(
        tracked.has(`packages/mobile/screenshots/${asset.name}`),
        `packages/mobile/screenshots/${asset.name} is not tracked by git. These are published store `
        + 'collateral, not build output: an untracked listing image exists on one disk, in no history, and '
        + 'nothing can say which build it depicts ',
    );
}
assert.ok(
    tracked.has('packages/mobile/screenshots/capture-pin.json'),
    'the capture pin itself must be tracked, or the record of which build the images depict is as ephemeral '
    + 'as the images were',
);

// And the ignore rule that caused it must not come back. Checked through
// `git check-ignore`, which answers what git will ACTUALLY do, rather than by
// grepping .gitignore for a pattern that could be re-spelled a dozen ways.
//
// `--no-index` is load-bearing and was found by trying to break this check:
// without it, check-ignore consults the index first and reports any TRACKED
// path as not-ignored, whatever the rules say. Restoring the exact
// `/packages/mobile/screenshots` line that caused  left this assertion
// green, because by then the images were tracked - a guard that cannot fail,
// certifying the one thing it was written to catch. With --no-index the rules
// are read on their own terms and the restored line goes red.
const ignored = (relPath) => {
    try {
        execFileSync('git', ['check-ignore', '--no-index', '-q', relPath], { cwd: repoRoot, stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
};
assert.equal(
    ignored('packages/mobile/screenshots/iphone-17-pro-max/01-balances.png'),
    false,
    'a listing screenshot is ignored again. That single .gitignore line is the whole of : it reads '
    + 'like a leftover from when these were build output, which they were until they were uploaded to a store',
);
// The harness debris around them SHOULD still be ignored: a multi-megabyte
// xcodebuild log per idiom per run is the churn the original rule was right
// about, and keeping it out is what makes tracking the images cheap.
assert.equal(
    ignored('packages/mobile/screenshots/iphone-17-pro-max/xcodebuild.log'),
    true,
    'the harness log is not ignored; tracking it would put a per-run build log in history beside the images',
);

console.log(
    'OK: iOS listing-assets smoke ( §6 / : the App Store set names a capture script and covers '
    + `both idioms with the same ${scenesOf('iphone-17-pro-max').length} scenes; all ${iosSet.assets.length} `
    + `images are pinned to ${pin.pin.capturedFrom.commit.slice(0, 8)} (v${pin.pin.capturedFrom.version}), still `
    + 'hash to what the capture recorded, and sit on one of the two canvases App Store Connect accepts; and '
    + 'they are TRACKED, with the .gitignore rule that hid them from history gone and the harness log still out)',
);
