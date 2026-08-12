// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: a STALE listing-asset verdict has to name the FILES that
// moved, not only the commits.
//
// The tool's own way out (2) is "read the commits and record why none of them
// can change these pixels", and until 2026-08-08 it printed `git log
// --oneline` and nothing else. Measured on the day, that is not enough to take
// the way out: `ddc94971`, subject "fix(desktop): the wallet's settings screen
// was dead", flagged all three Chrome Web Store screenshots. Read as a subject
// it is a desktop change that cannot reach an extension popup; read as a file
// list it is one shared stylesheet, packages/core/src/shared/routes/
// Home.module.css, which the popup does render. The step asked the operator to
// judge a diff it had declined to show them, at the one submission that gets a
// permanent extension ID.
//
// `depends` is directory-granular by design, so the scan over-reports. That is
// the point of the file list: it makes an over-report cheap to dismiss instead
// of a reason to re-shoot a store listing.
//
// Driven against a purpose-built history rather than this checkout's, for the
// reason the sibling direction smoke gives: CI checks out shallow, where real
// SHAs do not resolve.

import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { filesTouching } from '../../../tools/release/verify-listing-assets.mjs';

const repo = mkdtempSync(join(tmpdir(), 'xc997-drift-files-'));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

try {
    // `-c` rather than `git config`: the Mac's global config carries
    // commit.gpgsign, which turns a fixture commit into a pinentry prompt that
    // is red locally and green in CI.
    const commit = (msg, files) => {
        for (const [p, body] of Object.entries(files)) {
            mkdirSync(join(repo, dirname(p)), { recursive: true });
            writeFileSync(join(repo, p), body);
        }
        git('add', '-A');
        git('-c', 'commit.gpgsign=false', '-c', 'user.email=t@example.invalid',
            '-c', 'user.name=t', 'commit', '-q', '-m', msg);
        return git('rev-parse', 'HEAD');
    };

    git('init', '-q', '-b', 'main');

    // The asset depicts a directory, the way the real asset map does.
    const depends = ['depicted/'];

    const captured = commit('capture ran here', {
        'depicted/Home.module.css': 'a',
        'elsewhere/desktop.js': 'a',
    });

    // One commit whose SUBJECT names another shell, touching one file the
    // asset depicts and one it does not. This is ddc94971's exact shape.
    const target = commit('fix(desktop): the settings screen was dead', {
        'depicted/Home.module.css': 'b',
        'elsewhere/desktop.js': 'b',
    });

    const opts = { cwd: repo };

    const files = filesTouching(captured, target, depends, opts);
    assert.deepEqual(files, ['depicted/Home.module.css'],
        'a STALE verdict must name the depicted files the flagged commits changed. Without them '
        + 'the operator is told a subject line ("fix(desktop): ...") and asked to decide whether '
        + 'it can reach a Chrome popup, which the subject cannot answer. Reported: '
        + JSON.stringify(files));

    assert.ok(!files.includes('elsewhere/desktop.js'),
        'the file list is restricted to the paths the asset depicts. Listing every file in the '
        + 'commit would bury the one that matters under the rest of the change, which is the '
        + 'same unreadable verdict in a longer form.');

    // A range with no depicted change reports nothing, so an empty list means
    // "nothing it depicts moved" rather than "the scan was not run".
    assert.deepEqual(filesTouching(target, target, depends, opts), [],
        'an empty range must report no files. If this ever returns rows, a CLEAN verdict and a '
        + 'STALE one would print the same evidence block.');

    console.log('OK: listing-asset drift names the depicted files, not only the commits '
        + '(1 depicted file reported, 1 undepicted file correctly withheld, empty range clean)');
} finally {
    rmSync(repo, { recursive: true, force: true });
}
