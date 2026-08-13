// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for : the Play listing images are DATED, and the note that
// dates them still describes the bytes on disk.
//
// The extension set got this in  row 42 and the Play set did not, which
// is the whole of the finding: `packages/mobile/store-assets/play/` last
// changed in 7110d2e1 (2026-08-02, v0.334.0), the release was v0.336.0, and
// nothing in the repo could say which build those six images depict. Play
// binds them to a listing at upload the same way the Chrome Web Store does.
//
// WHAT THIS FILE GATES, AND WHAT IT DELIBERATELY DOES NOT. It holds the
// pin-versus-bytes half only, which is checkable everywhere and always: the
// pin exists, covers every declared asset, describes no file that is not one,
// and every asset still hashes to what the pin recorded. The DRIFT half (has a
// depicted surface moved since the capture?) is not gated here and must not
// be: it goes red on every UI commit until somebody reshoots the set, and a
// gate that is red by design gets waived and then ignored. Drift is only a
// defect at the moment the images are uploaded, so it is asked at the Play
// upload step, mirroring the placement the extension set chose for Phase 5.
//
// So a green run here does NOT mean the listing images are current. It means
// nobody replaced, re-cropped or hand-edited one without re-pinning, and that
// the tool can still answer the currency question when the upload step asks
// it. Those are different claims and this file only makes the second.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SETS, verifyPin } from '../../../tools/release/verify-listing-assets.mjs';
import { docsAvailable, readDoc, WALLET_DOCS } from '../_docs-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

let failures = 0;
const check = (label, fn) => {
    try {
        fn();
    } catch (err) {
        failures += 1;
        console.error(`FAIL: ${label}\n  ${err.message}`);
    }
};

const playSet = SETS.play;

// --- 1. The set is declared at all ------------------------------------------

// Guarded rather than assumed: every check below reads through `playSet`, and
// a bare TypeError on an absent set would report as a crash instead of as the
// finding, which is the one reading nobody would act on.
if (!playSet) {
    console.error('FAIL: tools/release/verify-listing-assets.mjs declares no `play` set. The Play '
        + 'listing images go back to being undated, which is the  defect exactly.');
    process.exit(1);
}

// Repo-relative, because that is how every message below has to name a file
// for the reader to be able to open it.
const setDir = relative(root, playSet.dir);

check('the play set points at the Play listing images', () => {
    assert.equal(setDir, 'packages/mobile/store-assets/play',
        `the play set points at ${setDir}, which is not where the Play listing images live. `
        + 'A set aimed at the wrong directory reports CLEAN about files nobody uploads.');
});

// --- 2. It covers the images the listing actually takes ---------------------

// The four screenshots are the ones  named; the icon and the feature
// graphic are bound to the same listing by the same upload, so they are
// covered too. Named here rather than globbed off the directory on purpose:
// a glob would let an asset silently LEAVE the tree and the map together,
// which is the disappearance this file is supposed to notice.
const EXPECTED = [
    'screenshots/01-balances.png',
    'screenshots/02-receive.png',
    'screenshots/03-confirm.png',
    'screenshots/04-biometric.png',
    'icon-512.png',
    'feature-graphic-1024x500.png',
];

check('every Play listing image is on disk and in the map', () => {
    const declared = new Set(playSet.assets.map((a) => a.name));
    for (const name of EXPECTED) {
        assert.ok(existsSync(join(root, setDir, name)),
            `${setDir}/${name} is gone from the tree. If the listing dropped it, drop it from the `
            + 'asset map in the same commit; a map naming a file that is not there is checked '
            + 'against nothing.');
        assert.ok(declared.has(name),
            `${name} is a Play listing image and the asset map in `
            + 'tools/release/verify-listing-assets.mjs does not name it. An unmapped asset is '
            + 'unpinned, and an unpinned asset is one nothing can date.');
    }
});

check('every mapped asset says what it shows and what it depends on', () => {
    for (const asset of playSet.assets) {
        assert.ok(asset.shows && asset.shows.length > 0,
            `${asset.name} has no \`shows\` line. That string is what a STALE verdict prints, and a `
            + 'verdict naming a filename instead of a screen is one nobody can act on.');
        assert.ok(Array.isArray(asset.depends) && asset.depends.length > 0,
            `${asset.name} declares no \`depends\` paths, so the drift half can never find anything `
            + 'and the asset reads CLEAN forever. That is worse than no check.');
        for (const dep of asset.depends) {
            assert.ok(existsSync(join(root, dep)),
                `${asset.name} depends on ${dep}, which does not exist. \`git log -- <path>\` over a `
                + 'path that is gone returns nothing, so a dead entry silently removes a surface '
                + 'from the drift question instead of failing.');
        }
    }
});

// --- 3. The pin exists and still describes these bytes ----------------------

const pinned = verifyPin({ set: 'play' });

check('the Play listing assets carry a usable capture pin', () => {
    assert.ok(!pinned.reason,
        `the Play listing images have no usable capture pin: ${pinned.reason}. Their pixel `
        + 'dimensions cannot say which build they depict, so the Play console gets six images '
        + 'nobody can date. Write it with: node tools/release/verify-listing-assets.mjs --write '
        + '--set play --how derived --commit <the commit the images landed in>.');
});

if (!pinned.reason) {
    check('every Play asset still hashes to its pin', () => {
        assert.deepEqual(pinned.hashProblems, [],
            'the Play listing images no longer match their capture pin. Either an image was '
            + 'replaced, re-cropped or hand-edited without re-pinning, or the pin was edited to '
            + 'describe bytes that are not there. Reshoot the set per '
            + 'packages/mobile/store-assets/play/README.md and re-pin, or re-pin the bytes you '
            + 'meant to keep.');
    });

    check('the pin describes only Play listing assets', () => {
        assert.deepEqual(pinned.extra, [],
            'the Play capture pin describes files that are not listing assets. The pin and the '
            + 'asset map in tools/release/verify-listing-assets.mjs have to name the same files.');
    });

    check('the pin says whether it was observed or reconstructed', () => {
        const { how } = pinned.pin.capturedFrom;
        assert.ok(['capture', 'derived'].includes(how),
            `the Play capture pin records how=${how}, which is neither 'capture' (a real capture `
            + "run wrote it) nor 'derived' (reconstructed from git history). The field exists so a "
            + 'reader can tell an observation from a reconstruction, and this set is currently the '
            + 'reconstruction.');
    });

    check('the pin names its own set', () => {
        assert.equal(pinned.pin.set, 'play',
            `the Play capture pin says set=${pinned.pin.set}. Every set's pin is named `
            + 'capture-pin.json, so a copied file would date these images off another set\'s '
            + 'capture.');
    });

    check('the pinned version is the one that commit actually declared', () => {
        // The whole point of the pin is that it is a claim about a PAST tree.
        // Writing today's version beside a commit from a week ago is the exact
        // confident-wrong-number this mechanism exists to stop, and once
        // written it is invisible: the field looks like every other version.
        //
        // Verified against git rather than trusted, and SKIPPED loudly when the
        // history is not here. A shallow clone must not read as agreement.
        const { commit, version } = pinned.pin.capturedFrom;
        let declared;
        try {
            declared = JSON.parse(execFileSync(
                'git', ['show', `${commit}:package.json`],
                { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
            )).version;
        } catch {
            console.log(`  (skipped: ${commit.slice(0, 8)} is not in this checkout, so the pinned `
                + 'version cannot be checked against it here)');
            return;
        }
        assert.equal(version, declared,
            `the Play pin says the images were captured at v${version}, but ${commit.slice(0, 8)} `
            + `declares v${declared}. One of the two was hand-written. The version is read out of `
            + 'the pinned commit precisely so it cannot be a guess.');
    });
}

// --- 4. The set is honest about having no capture harness -------------------

// The extension set's gate holds its capture script to still calling
// writePin(). This set has no such script, and saying so in the map with an
// explicit null is what lets that gate skip HERE by statement rather than by
// accident. If somebody wires an Android capture, this flips to the same
// requirement without anybody having to remember it.
check('the play set declares its capture harness, or honestly declares none', () => {
    assert.ok(playSet.capture === null || typeof playSet.capture === 'string',
        "the play set's `capture` field is neither a script path nor an explicit null. Left "
        + 'undefined it reads as "no harness" by accident rather than by statement.');
    if (playSet.capture !== null) {
        assert.ok(existsSync(join(root, playSet.capture)),
            `the play set names ${playSet.capture} as its capture script and no such file exists.`);
        const src = readFileSync(join(root, playSet.capture), 'utf8');
        assert.ok(/writePin\(/.test(src),
            `${playSet.capture} is declared as the Play capture harness but never calls writePin(). `
            + 'A capture that does not re-pin leaves a stale note beside fresh images, and the note '
            + 'is the only thing that says which build the listing shows.');
    }
});

check('a STALE verdict tells the operator how to re-pin', () => {
    assert.ok(/--set play/.test(playSet.recapture || ''),
        "the play set's STALE message does not name the `--set play` flag an operator needs to "
        + 're-pin. A verdict that states a problem and not its remedy gets uploaded past.');
});

// --- 5. The canvas rule matches what Play actually accepts ------------------

check('the set-wide canvas rule covers every asset it is applied to', () => {
    assert.ok(Array.isArray(playSet.sizes) && playSet.sizes.length > 0,
        'the play set declares no `sizes`, so an image that drifted to an off-canvas size would '
        + 'reach the Play console before anything refused it.');
    // Every pinned dimension must be a canvas the rule allows, or the rule is
    // describing a listing other than this one.
    for (const [name, rec] of Object.entries(pinned.pin?.assets || {})) {
        if (!rec.width) continue;
        assert.ok(playSet.sizes.some((c) => c.width === rec.width && c.height === rec.height),
            `${name} is pinned at ${rec.width}x${rec.height}, which the play set's own canvas rule `
            + `does not allow (${playSet.sizes.map((c) => `${c.width}x${c.height}`).join(', ')}). `
            + 'Either the rule is wrong or the image is, and a rule that forbids the shipped asset '
            + 'is a gate nobody can pass.');
    }
});

// --- 6. The drift question is really asked, at the step that uploads --------
//
// The other half of the split declared at the top of this file. Pin-versus-
// bytes is gated above; drift is only a defect at the moment the images are
// bound to a listing, so it is asked in the ceremony instead of here. That
// placement only works if the step exists and really runs the tool, which is
// why the extension lane gates its own Phase 5 the same way: a step that
// merely SAYS to check the screenshots is prose behind a green check.
//
// Read out of the sibling docs checkout, which is where the wallet's operator
// pages live. An absent-and-undeclared sibling skips this section alone rather
// than the whole file: the pin checks above need no docs and must not be lost
// to a checkout that has none. A DECLARED sibling that is missing exits inside
// docsAvailable(), which is the intended red.
const PLAY_PAGE = ['release', 'mobile', 'android-play.md'];

if (docsAvailable()) {
    // 2b is the listing form: the phase that puts the icon, the feature
    // graphic and the four screenshots into the console. Sliced rather than
    // searched whole-page, so a mention of the tool somewhere else on the page
    // cannot stand in for the step at the upload.
    const ceremony = readDoc(...PLAY_PAGE);
    const start = ceremony.indexOf('#### 2b');
    const end = ceremony.indexOf('### Phase 3');
    const uploadStep = (start >= 0 && end > start) ? ceremony.slice(start, end) : '';

    check('the Play ceremony still has the listing step that uploads the images', () => {
        assert.ok(uploadStep.length > 0,
            `the 2b listing step is not on ${WALLET_DOCS}/release/mobile/android-play.md, and it is `
            + 'the step that uploads the six listing assets. Either the phase was renamed or the '
            + 'ceremony was scrubbed; either way the drift question now has nowhere to be asked.');
    });

    const toolLines = uploadStep.split('\n')
        .filter((l) => l.includes('tools/release/verify-listing-assets.mjs'));

    check('the Play upload step asks which build the images depict', () => {
        assert.ok(toolLines.length > 0,
            'the Play listing step never runs tools/release/verify-listing-assets.mjs. The assets '
            + 'are checked for their dimensions in two places and for what they DEPICT in none, so '
            + 'a screenshot of a build nobody can install uploads clean onto the live listing.');
    });

    check('it is asked for THIS set and against the tag being shipped', () => {
        const drift = toolLines.find((l) => l.includes('--since'));
        assert.ok(drift,
            'the Play listing step names the verifier but never with `--since`. Defaulted to HEAD '
            + "it measures this machine's working tree, which is not what is being uploaded, and it "
            + 'reports CLEAN on a checkout that happens to sit at the capture commit.');
        assert.match(drift, /--set\s+play/,
            `the drift line reads \`${drift.trim()}\` and does not name \`--set play\`. Without it `
            + 'the tool checks the extension set, so the Play images upload unmeasured behind a '
            + 'green run about another store.');
        assert.match(drift, /--since\s+v/,
            `the drift line reads \`${drift.trim()}\`, whose \`--since\` is not a version tag. The `
            + 'subject of the question is the build being uploaded, so the ref has to be the tag.');
    });

    check('all three verdicts are written down', () => {
        // A three-state check read as two states resolves the missing state as
        // a pass, and INCONCLUSIVE is the one that gets dropped: this set has
        // no capture harness, so "no pin" is a live way to reach it.
        for (const [word, why] of [
            ['CLEAN', 'the passing outcome'],
            ['STALE', 'the outcome that must stop the upload'],
            ['INCONCLUSIVE', 'the outcome that looks like neither and is not a pass'],
        ]) {
            assert.ok(uploadStep.includes(word),
                `the Play listing step does not say what ${word} means (${why}). A verdict an `
                + 'operator cannot read is one they resolve in favour of uploading.');
        }
    });

    check('the way out matches the fact that this lane has no capture script', () => {
        // The iOS page can say "re-run the capture, it re-pins itself". Here
        // there is no such script, so an operator who follows that wording
        // hunts for a harness that does not exist and hand-writes a pin
        // instead, which is the failure the pin exists to prevent.
        assert.ok(/--write/.test(uploadStep) && /--set\s+play/.test(uploadStep),
            'the Play listing step never tells the operator how to re-pin after a reshoot '
            + '(`node tools/release/verify-listing-assets.mjs --write --set play`). This set '
            + `declares capture: ${JSON.stringify(playSet.capture)}, so nothing else writes that `
            + 'pin, and a step that states a problem without its remedy gets uploaded past.');
    });
}

if (failures > 0) {
    console.error(`\n${failures} Play listing-asset gate check(s) failed`);
    process.exit(1);
}

console.log(`OK: Play listing assets  - ${playSet.assets.length} assets pinned to `
    + `${pinned.pin.capturedFrom.commit.slice(0, 8)} (v${pinned.pin.capturedFrom.version}, `
    + `how=${pinned.pin.capturedFrom.how}) via ${relative(root, playSet.pinPath)}`);
