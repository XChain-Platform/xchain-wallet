#!/usr/bin/env node
// Swap the installed xchain-sdk for a symlink to a local checkout, and back.
//
// D8. The three shells depend on the SDK as a REGISTRY
// package (`xchain-sdk: npm:@dankest-llc/xchain-sdk@<version>`), because
// that is the only form that pins which SDK went into a signed release,
// installs on a runner holding nothing but this repo, and gives a
// third-party verifier something to install.
//
// WHY THIS SCRIPT EXISTS RATHER THAN A SECOND DEPENDENCY MODE. Editing the
// SDK and seeing it in a wallet dev server is a real daily workflow, and
// the obvious way to keep it - flipping the manifests back to `link:` under
// an env var, a .pnpmfile hook, an override - all rewrite the LOCKFILE.
// This repo is shared with a second coder who commits by pathspec, so a
// lockfile that differs depending on who ran install last is a committed
// accident waiting to happen, and the accident silently un-pins the SDK
// for everyone including a release.
//
// So the link lives entirely inside node_modules, which is ignored by
// definition. No manifest changes, no lockfile changes, nothing to commit
// by mistake. The direction of failure is the safe one too: forget to run
// this and you get the pinned registry SDK, which is what a release wants.
// The old arrangement failed the other way, where forgetting anything at
// all gave you whatever happened to be in a neighbour's worktree.
//
//   node tools/dev/sdk-link.mjs link     [--sdk <path>]
//   node tools/dev/sdk-link.mjs unlink
//   node tools/dev/sdk-link.mjs status
//
// `unlink` restores what the installer put there by moving the saved copy
// back, so it does not need a network round trip.

import {
    existsSync, lstatSync, renameSync, rmSync, symlinkSync, readlinkSync,
    readFileSync, writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHELLS = ['web', 'extension', 'desktop'];
const PKG = 'xchain-sdk';
// Suffix rather than a sibling directory: pnpm walks node_modules looking
// for packages, and a stashed copy under a plausible package name would be
// found by tooling that has no idea it is a backup.
const STASH = `${PKG}.registry-backup`;
// What the installer left behind, so `unlink` can put it back byte for byte.
//
// UNDER pnpm THE INSTALLED ENTRY IS ITSELF A SYMLINK, into
// `node_modules/.pnpm/@dankest-llc+xchain-sdk@<version>/...`, which is why
// this file exists at all: an earlier version of this script assumed the
// installed state was a real directory, so it saw pnpm's own symlink,
// concluded a dev link was already in place, and deleted it with nothing
// stashed. Recording the target string handles the store layout (symlink)
// and npm/yarn's (real directory) without guessing which one is in front
// of it.
const RECORD = `${PKG}.registry-link.json`;

const args = process.argv.slice(2);
const command = args[0];
const sdkFlag = args.indexOf('--sdk');
const sdkPath = path.resolve(
    sdkFlag >= 0 ? args[sdkFlag + 1] : process.env.XCHAIN_SDK_PATH || path.join(REPO_ROOT, '../xchain-sdk'),
);

function shellModules(shell) {
    const dir = path.join(REPO_ROOT, 'packages', shell, 'node_modules');
    return {
        dir,
        live: path.join(dir, PKG),
        stash: path.join(dir, STASH),
        record: path.join(dir, RECORD),
    };
}

// A dev link points at the SDK checkout; pnpm's own link points into the
// store. Telling them apart is what keeps `link` idempotent and stops
// `unlink` from restoring a link onto itself.
function isDevLink(live) {
    if (classify(live) !== 'symlink') return false;
    const target = path.resolve(path.dirname(live), readlinkSync(live));
    return !target.includes(`${path.sep}.pnpm${path.sep}`);
}

function classify(live) {
    if (!existsSync(live) && !isBrokenLink(live)) return 'absent';
    return lstatSync(live).isSymbolicLink() ? 'symlink' : 'directory';
}

// existsSync follows symlinks, so a link pointing at a deleted SDK reads as
// absent while the entry is still very much there and still shadowing.
function isBrokenLink(p) {
    try {
        lstatSync(p);
        return true;
    } catch {
        return false;
    }
}

function status() {
    for (const shell of SHELLS) {
        const { live, stash } = shellModules(shell);
        const kind = classify(live);
        const target = kind === 'symlink' ? ` -> ${readlinkSync(live)}` : '';
        const stashed = existsSync(stash) || isBrokenLink(stash) ? ' (registry copy stashed)' : '';
        console.log(`${shell.padEnd(10)} ${kind}${target}${stashed}`);
    }
}

function link() {
    if (!existsSync(path.join(sdkPath, 'package.json'))) {
        console.error(`sdk-link: no package.json at ${sdkPath}`);
        console.error('  Pass --sdk <path> or set XCHAIN_SDK_PATH to your SDK checkout.');
        process.exit(1);
    }
    for (const shell of SHELLS) {
        const {
            dir, live, stash, record,
        } = shellModules(shell);
        if (!existsSync(dir)) {
            console.error(`sdk-link: ${shell} has no node_modules; run pnpm install first.`);
            process.exit(1);
        }
        const kind = classify(live);
        // Never overwrite a saved state: a second `link` would otherwise
        // record the FIRST link as the thing to restore, and `unlink` would
        // hand back a dev link while reporting success.
        const alreadySaved = existsSync(record) || existsSync(stash) || isBrokenLink(stash);
        if (kind === 'symlink') {
            if (!alreadySaved && !isDevLink(live)) {
                writeFileSync(record, `${JSON.stringify({ target: readlinkSync(live) }, null, 2)}\n`);
            }
            rmSync(live, { force: true });
        } else if (kind === 'directory') {
            if (alreadySaved) rmSync(live, { recursive: true, force: true });
            else renameSync(live, stash);
        }
        symlinkSync(sdkPath, live, 'dir');
        console.log(`${shell}: linked -> ${sdkPath}`);
    }
    console.log('\nThe lockfile is untouched. `git status` should show no change.');
}

function unlink() {
    let missing = 0;
    for (const shell of SHELLS) {
        const { live, stash, record } = shellModules(shell);
        if (classify(live) === 'symlink') rmSync(live, { force: true });
        if (existsSync(record)) {
            const { target } = JSON.parse(readFileSync(record, 'utf8'));
            symlinkSync(target, live, 'dir');
            rmSync(record, { force: true });
            console.log(`${shell}: restored the installer's link`);
        } else if (existsSync(stash) || isBrokenLink(stash)) {
            renameSync(stash, live);
            console.log(`${shell}: restored the registry copy`);
        } else {
            missing += 1;
            console.log(`${shell}: nothing saved to restore; run pnpm install`);
        }
    }
    if (missing) process.exitCode = 1;
}

switch (command) {
    case 'link':
        link();
        break;
    case 'unlink':
        unlink();
        break;
    case 'status':
        status();
        break;
    default:
        console.error('usage: node tools/dev/sdk-link.mjs <link|unlink|status> [--sdk <path>]');
        process.exit(1);
}
