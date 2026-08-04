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

// tools/release/manifest-diff.mjs - structural manifest.json compare
// ( §4 "Post-publish verification"), used by verify-store.sh.
//
// The Chrome Web Store rewrites manifest.json on publish: it injects
// `update_url` (the store's update-check endpoint) and `key` (the
// base64 public key that keeps the extension ID stable) into the copy it
// serves. A byte-for-byte file diff against the CI-built manifest.json
// therefore fails on EVERY publish, store-injected keys included, even
// when nothing else changed. A check that always fails gets waived and
// then ignored - the failure mode this script exists to avoid. See
// verify-store.sh's header for the fuller reasoning; this file is only
// the comparison primitive.
//
// What this does: deep-equal two JSON files after deleting exactly the
// known store-injected top-level keys from BOTH sides (deleting from
// both is symmetric and harmless: our own manifest.json never has
// `update_url` or `key` set, so there is nothing to lose on that side).
// Every other key, at any depth, must be exactly equal. Key ORDER does
// not matter; VALUE does.
//
// Usage:
//   node tools/release/manifest-diff.mjs <ours.json> <theirs.json> \
//     [--ignore update_url,key]
//
// Exit 0 and prints "manifest-diff: ok" when equal after ignoring the
// listed keys. Exit 1 and prints every path that differs otherwise.

import { readFileSync } from 'node:fs';

const DEFAULT_IGNORE = ['update_url', 'key'];

const USAGE = `manifest-diff.mjs - structural manifest.json compare ( §4
post-publish verification). The comparison primitive behind verify-store.sh.

Usage:
  node tools/release/manifest-diff.mjs <ours.json> <theirs.json> \\
      [--ignore key1,key2]

Arguments:
  <ours.json>    the CI-built manifest
  <theirs.json>  the manifest the Chrome Web Store serves

Options:
  --ignore <keys>  comma-separated top-level keys deleted from BOTH sides
                   before comparing (default: ${DEFAULT_IGNORE.join(',')})
  -h, --help       print this and exit 0

The store REWRITES manifest.json on publish, injecting update_url (its
update-check endpoint) and key (the base64 public key that keeps the
extension ID stable). A byte-for-byte diff therefore fails on every publish
even when nothing changed, and a check that always fails gets waived and
then ignored. Deleting those keys from both sides is symmetric and loses
nothing: our own manifest never sets either.

Every other key, at any depth, must be exactly equal. Key ORDER does not
matter; VALUE does.

Exit codes:
  0  equal after ignoring the listed keys
  1  structural mismatch; every differing path is printed
  2  bad invocation (missing file argument, or --ignore with no value)
`;

function parseArgs(argv) {
    const positional = [];
    let ignore = DEFAULT_IGNORE;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--ignore') {
            const raw = argv[i + 1];
            if (!raw) {
                console.error('manifest-diff: --ignore requires a comma-separated value');
                process.exit(2);
            }
            ignore = raw.split(',').map((s) => s.trim()).filter(Boolean);
            i++;
        } else if (arg === '--help' || arg === '-h') {
            // One line was not enough . It named the arguments and
            // nothing else, so it could not answer the question an operator
            // running verify-store.sh actually has when a diff comes back
            // non-empty: which keys are supposed to differ, and what does a
            // non-zero exit mean. The §13 gate now requires more than a token,
            // for exactly that reason.
            console.log(USAGE);
            process.exit(0);
        } else {
            positional.push(arg);
        }
    }
    return { positional, ignore };
}

function readJSON(path) {
    let raw;
    try {
        raw = readFileSync(path, 'utf8');
    } catch (err) {
        console.error(`manifest-diff: cannot read ${path}: ${err.message}`);
        process.exit(2);
    }
    try {
        return JSON.parse(raw);
    } catch (err) {
        console.error(`manifest-diff: ${path} is not valid JSON: ${err.message}`);
        process.exit(2);
    }
}

function stripIgnored(obj, ignore) {
    const copy = { ...obj };
    for (const key of ignore) delete copy[key];
    return copy;
}

// Recursive structural diff. Returns an array of human-readable path
// strings for every mismatch (missing key, extra key, changed value,
// type change). Order-insensitive for object keys; array order DOES
// matter (a reordered content-script matches list is a real manifest
// change worth flagging structurally, unlike the freeze gate's
// order-independent set compare, which is about pattern membership, not
// about whether this specific served copy matches byte-for-byte).
function diff(a, b, path, out) {
    if (a === b) return;
    const aIsObj = a !== null && typeof a === 'object';
    const bIsObj = b !== null && typeof b === 'object';

    if (!aIsObj || !bIsObj) {
        if (a !== b) out.push(`${path || '(root)'}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
        return;
    }

    const aIsArr = Array.isArray(a);
    const bIsArr = Array.isArray(b);
    if (aIsArr !== bIsArr) {
        out.push(`${path || '(root)'}: type mismatch (array vs object)`);
        return;
    }

    if (aIsArr) {
        const len = Math.max(a.length, b.length);
        for (let i = 0; i < len; i++) {
            if (i >= a.length) {
                out.push(`${path}[${i}]: missing on our side, present on theirs: ${JSON.stringify(b[i])}`);
            } else if (i >= b.length) {
                out.push(`${path}[${i}]: present on our side, missing on theirs: ${JSON.stringify(a[i])}`);
            } else {
                diff(a[i], b[i], `${path}[${i}]`, out);
            }
        }
        return;
    }

    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of [...keys].sort()) {
        const p = path ? `${path}.${key}` : key;
        if (!(key in a)) {
            out.push(`${p}: missing on our side, present on theirs: ${JSON.stringify(b[key])}`);
        } else if (!(key in b)) {
            out.push(`${p}: present on our side, missing on theirs: ${JSON.stringify(a[key])}`);
        } else {
            diff(a[key], b[key], p, out);
        }
    }
}

export function structuralDiff(ours, theirs, ignore = DEFAULT_IGNORE) {
    const a = stripIgnored(ours, ignore);
    const b = stripIgnored(theirs, ignore);
    const mismatches = [];
    diff(a, b, '', mismatches);
    return mismatches;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { positional, ignore } = parseArgs(process.argv.slice(2));
    const [oursPath, theirsPath] = positional;
    if (!oursPath || !theirsPath) {
        console.error('Usage: node manifest-diff.mjs <ours.json> <theirs.json> [--ignore key1,key2]');
        process.exit(2);
    }
    const ours = readJSON(oursPath);
    const theirs = readJSON(theirsPath);
    const mismatches = structuralDiff(ours, theirs, ignore);
    if (mismatches.length === 0) {
        console.log(`manifest-diff: ok (ignored keys: ${ignore.join(', ') || '(none)'})`);
        process.exit(0);
    }
    console.error(`manifest-diff: ${mismatches.length} structural mismatch(es) (ignored keys: ${ignore.join(', ') || '(none)'}):`);
    for (const m of mismatches) console.error(`  - ${m}`);
    process.exit(1);
}
