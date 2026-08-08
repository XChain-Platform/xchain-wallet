// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for : which DIRECTION the listing capture sits in relative to
// the ref being submitted.
//
// verify-listing-assets.mjs asks `git log pin..target` over each asset's
// surfaces, and that range is empty whenever target is an ANCESTOR of pin, so
// until 2026-08-07 a capture taken from a build NEWER than the release read as
// CLEAN. That is not a corner case here, it is the shape of a submission: the
// only commit a tag may name is the last one carrying a green CI run, while
// captures get re-taken on the tip. Measured on the day: the pin stood at
// 42bda8b1 and the sole taggable commit was 51bed8f0, five commits behind it.
//
// The classifier is tested against a purpose-built history rather than against
// this checkout's, for two reasons: a direction needs both directions to be
// worth asserting, and CI checks out shallow, where real SHAs do not resolve.

import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { captureVsTarget } from '../../../tools/release/verify-listing-assets.mjs';

const repo = mkdtempSync(join(tmpdir(), 'xc997-capture-direction-'));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

try {
    // `-c` rather than `git config`: the Mac's global config carries
    // commit.gpgsign, which turns a fixture commit into a pinentry prompt that
    // is red locally and green in CI.
    const commit = (msg) => {
        writeFileSync(join(repo, 'surface.txt'), msg);
        git('add', 'surface.txt');
        git('-c', 'commit.gpgsign=false', '-c', 'user.email=t@example.invalid',
            '-c', 'user.name=t', 'commit', '-q', '-m', msg);
        return git('rev-parse', 'HEAD');
    };

    git('init', '-q', '-b', 'main');
    const older = commit('older');
    const newer = commit('newer');

    // A sibling history, so 'divergent' is a measured state and not a
    // fall-through nobody has ever reached.
    git('checkout', '-q', '-b', 'side', older);
    const side = commit('side');

    const opts = { cwd: repo };

    assert.equal(captureVsTarget(newer, newer, opts), 'same',
        'a capture at the ref being submitted is neither ahead nor behind it');

    assert.equal(captureVsTarget(older, newer, opts), 'behind',
        'a capture OLDER than the ref being submitted is the ordinary stale-screenshot case, '
        + 'which the per-asset drift scan already covers');

    // The regression this file exists for. Before the fix this pair produced
    // an empty `pin..target` range and the tool printed CLEAN.
    assert.equal(captureVsTarget(newer, older, opts), 'ahead',
        'a capture NEWER than the ref being submitted must be reported as ahead. This is the '
        + 'case that used to read as CLEAN: `git log pin..target` is empty when target is an '
        + 'ancestor of pin, so the images could advertise a product the upload does not '
        + 'contain and no check would say so.');

    assert.equal(captureVsTarget(side, newer, opts), 'divergent',
        'a capture on a history the submitted ref does not contain, and which does not contain '
        + 'it either, is divergent rather than silently clean');
    assert.equal(captureVsTarget(newer, side, opts), 'divergent',
        'divergence is symmetric');
} finally {
    rmSync(repo, { recursive: true, force: true });
}

console.log('[listing-asset-capture-direction] ok');
