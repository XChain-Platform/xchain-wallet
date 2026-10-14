// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Umask-proof file modes for everything the Linux packages copy verbatim.
//
// WHY THIS EXISTS. The v0.341.3 reproduce check failed on all four Linux
// packages (both AppImages, both .deb files) while the payload bytes, the
// ar members' headers, control.tar.xz, the AppImage runtime and every
// timestamp matched. The whole difference was ONE mode bit on ONE file:
//
//   usr/share/icons/hicolor/1024x1024/apps/xchain-wallet.png
//     CI (GitHub runner, umask 022):  -rw-r--r--  (0644)
//     dev host (Ubuntu login, umask 002): -rw-rw-r--  (0664)
//
// That icon is build/icon.png copied byte-for-byte (same sha256), and both
// fpm and the AppImage stage copy it WITH its mode. A git checkout writes
// non-executable files as `0666 & ~umask`, so the checkout's mode is the
// host's umask, not the commit's, and it reaches the container through the
// /workspace bind mount untouched. The container's own umask (022) never
// gets a say over a file it did not create. Every other packaged file is
// either generated inside the container or stored without its mode (asar),
// which is why the icon was the only one that moved.
//
// THE RULE. A mode is derived from its owner bits alone, which no sane
// umask touches: group and other get the owner's read and execute bits and
// never write. So 0664 and 0644 both become 0644, 0775 and 0755 both become
// 0755, and a deliberately read-only 0444 stays 0444. Special bits are kept
// as they are: chrome-sandbox ships setuid (the deb postinst relies on it),
// and flattening everything to 0644/0755 would quietly drop that. Symlinks
// are skipped: Linux has no lchmod, and a link's own mode is never packaged.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * The umask-independent form of a mode: owner bits as they are, group and
 * other set to the owner's read+execute, special bits (setuid, setgid,
 * sticky) preserved.
 *
 * @param {number} mode a stat mode or its permission bits
 * @returns {number} permission bits (0o7777 range)
 */
function canonicalMode(mode) {
    const special = mode & 0o7000;
    const owner = (mode >> 6) & 0o7;
    const shared = owner & 0o5;
    return special | (owner << 6) | (shared << 3) | shared;
}

/**
 * Rewrite every mode under `root` (root included) to its canonical form.
 * Depth-first, symlinks skipped, and only entries whose mode actually
 * differs are touched. Throws on any stat or chmod failure: a tree that
 * could not be normalized must stop the build rather than package a
 * host-dependent mode.
 *
 * @param {string} root directory or file to normalize
 * @returns {number} how many entries were changed
 */
function normalizeTreeModes(root) {
    let changed = 0;
    const walk = (entry) => {
        const stats = fs.lstatSync(entry);
        if (stats.isSymbolicLink()) return;
        if (stats.isDirectory()) {
            for (const child of fs.readdirSync(entry)) {
                walk(path.join(entry, child));
            }
        }
        const current = stats.mode & 0o7777;
        const wanted = canonicalMode(current);
        if (current !== wanted) {
            fs.chmodSync(entry, wanted);
            changed += 1;
        }
    };
    walk(root);
    return changed;
}

module.exports = { canonicalMode, normalizeTreeModes };
