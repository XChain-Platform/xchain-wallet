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

// Removes marked visual comparison reports from temporary storage.
//
//     node tools/visual-clean.mjs [--root <tmp-dir>] [--max-age-hours 24] [--all]

import {
    existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VISUAL_REPORT_GENERATOR } from './visual-report-files.mjs';

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) { out[key] = true; continue; }
        out[key] = next;
        i += 1;
    }
    return out;
}

function canonicalPath(path) {
    const tail = [];
    let parent = resolve(path);
    while (!existsSync(parent)) {
        const next = dirname(parent);
        if (next === parent) break;
        tail.unshift(parent.slice(next.length + (next.endsWith(sep) ? 0 : 1)));
        parent = next;
    }
    return resolve(realpathSync(parent), ...tail);
}

function isWithin(parent, child) {
    const rel = relative(parent, child);
    return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

export function isTemporaryRoot(path) {
    const canonical = canonicalPath(path);
    const systemTmp = canonicalPath(tmpdir());
    return isWithin(systemTmp, canonical) || canonical.split(sep).includes('tmp');
}

function reportIndex(dir) {
    try {
        const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
        return index.generator === VISUAL_REPORT_GENERATOR ? index : null;
    } catch {
        return null;
    }
}

function directoryBytes(path) {
    const stat = lstatSync(path);
    if (!stat.isDirectory()) return stat.size;
    return readdirSync(path).reduce((total, name) => total + directoryBytes(join(path, name)), 0);
}

function findReports(root) {
    const reports = [];
    const visit = (dir) => {
        const index = reportIndex(dir);
        if (index) {
            reports.push({ dir, index });
            return;
        }
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) visit(join(dir, entry.name));
        }
    };
    visit(root);
    return reports;
}

export function cleanVisualReports(root, { all = false, maxAgeHours = 24, now = Date.now() } = {}) {
    const canonicalRoot = canonicalPath(root);
    if (!isTemporaryRoot(canonicalRoot)) throw new Error(`refusing root outside a tmp directory: ${canonicalRoot}`);
    if (!Number.isFinite(maxAgeHours) || maxAgeHours < 0) throw new Error('--max-age-hours must be a non-negative number');
    if (!existsSync(canonicalRoot)) return [];

    const cutoff = now - maxAgeHours * 60 * 60 * 1000;
    const removed = [];
    for (const report of findReports(canonicalRoot)) {
        const { dir, index } = report;
        const finishedAt = Date.parse(index.finishedAt);
        const reportTime = Number.isFinite(finishedAt) ? finishedAt : statSync(dir).mtimeMs;
        if (!all && reportTime >= cutoff) continue;
        const bytes = directoryBytes(dir);
        rmSync(dir, { recursive: true, force: true });
        removed.push({ dir, bytes });
    }
    return removed;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    if (args.root === true) throw new Error('--root requires a directory');
    const root = resolve(args.root || join(repoRoot, 'tmp', 'visual'));
    const maxAgeHours = args['max-age-hours'] === undefined
        ? 24
        : Number(args['max-age-hours'] === true ? Number.NaN : args['max-age-hours']);
    const removed = cleanVisualReports(root, { all: args.all === true, maxAgeHours });
    for (const item of removed) console.log(`removed ${item.dir}: ${item.bytes} bytes freed`);
    console.log(`${removed.length} report director${removed.length === 1 ? 'y' : 'ies'} removed`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (err) {
        console.error(err.message || err);
        process.exitCode = 2;
    }
}
