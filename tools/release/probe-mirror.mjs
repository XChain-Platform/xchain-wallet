// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A throwaway copy of a release input directory for the Phase 4 probe.
//
// sign.sh writes RELEASE_HASHES.txt into its --input before gpg runs, and refuses the next run
// when one is already there. Running it against a copy lets the probe observe the same gates
// without leaving that file behind in the operator's directory.
//
// The copy holds the whole tree, subdirectories included, because the ceremony-record gate
// reads records/. Regular files are copied with copy-on-write where the filesystem offers it,
// never hardlinked: sign.sh writes with `>`, which truncates in place, so a shared inode would
// let a write through the copy reach the original. The two names sign.sh produces are left
// out of the copy, so a directory a previous run signed is probed as a fresh signing would be.

import {
    constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, realpathSync,
    rmSync, statSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SIGNING_OUTPUTS = ['RELEASE_HASHES.txt', 'RELEASE_HASHES.txt.asc'];

function copyTree(from, to, skip) {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
        if (skip.includes(entry.name)) continue;
        const src = join(from, entry.name);
        const dst = join(to, entry.name);
        if (entry.isDirectory()) {
            mkdirSync(dst);
            copyTree(src, dst, []);
        } else if (entry.isSymbolicLink()) {
            symlinkSync(readlinkSync(src), dst);
        } else if (entry.isFile()) {
            copyFileSync(src, dst, constants.COPYFILE_FICLONE);
        }
    }
}

function realOrSelf(p) {
    try {
        return realpathSync(p);
    } catch {
        return resolve(p);
    }
}

// Where the copy lives. Beside the input when the input sits inside the repo being signed from:
// sign.sh refuses a repo whose `git status` is not clean, so a copy elsewhere would skip a
// refusal the real run hits. Anywhere else the system temp directory.
function mirrorParent(input, repo) {
    const realInput = realOrSelf(input);
    const realRepo = realOrSelf(repo);
    const inside = realInput === realRepo || realInput.startsWith(`${realRepo}${sep}`);
    return inside ? dirname(realInput) : tmpdir();
}

/**
 * Copy a release input directory for one probe run.
 *
 * Returns null when `input` is not a directory, so sign.sh can refuse it by its own words.
 *
 * @param {string} input
 * @param {string} repo
 * @returns {{dir: string, restore: (text: string) => string, cleanup: () => void} | null}
 */
export function mirrorInput(input, repo) {
    if (!existsSync(input) || !statSync(input).isDirectory()) return null;
    const dir = mkdtempSync(join(mirrorParent(input, repo), 'phase4-probe-'));
    const cleanup = () => rmSync(dir, { recursive: true, force: true });
    try {
        copyTree(input, dir, SIGNING_OUTPUTS);
    } catch (err) {
        cleanup();
        throw err;
    }
    // Longest first: the resolved form of a temp path can contain the unresolved one.
    const names = [...new Set([dir, realOrSelf(dir)])].sort((a, b) => b.length - a.length);
    const restore = (text) => names.reduce((t, name) => t.split(name).join(resolve(input)), String(text));
    return { dir, restore, cleanup };
}

const USAGE = `Usage: node tools/release/probe-mirror.mjs --help

probe-mirror.mjs is a library with no command of its own.
phase4-rehearsal.mjs imports mirrorInput() from it to copy a release
input directory before the Phase 4 probe runs sign.sh against the copy,
so RELEASE_HASHES.txt and its signature never land in the original.
`;

// Resolved through realpath so a symlinked or spaced checkout still answers.
const invokedDirectly = (() => {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
})();

if (invokedDirectly) {
    const args = process.argv.slice(2);
    if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
        process.stdout.write(USAGE);
        process.exit(0);
    }
    process.stderr.write(USAGE);
    process.exit(2);
}
