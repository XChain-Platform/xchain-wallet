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

// Folds rulings-gate seed runs into an allowlist.
//
//     RULINGS_SEED=<dir> pnpm test:e2e rulings-gate       (once per run dir)
//     node test/e2e/layout/seed-rulings-allowlist.mjs --out <file> --reason <text> <dir> [<dir> ...]
//
// Each run dir holds one <venue>.json per venue; the allowlist keeps the
// largest count each screen showed over the runs, so a finding that comes
// and goes between runs does not turn the gate red. Seeding is for the
// gate's first measured head; after that the allowlist only shrinks.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedAllowlist } from './rulings-gate.js';

const argv = process.argv.slice(2);
const take = (flag) => {
    const i = argv.indexOf(flag);
    if (i < 0) return null;
    const [value] = argv.splice(i, 2).slice(1);
    return value;
};
const out = take('--out');
const reason = take('--reason');
if (!out || !reason || argv.length === 0) {
    console.error('usage: seed-rulings-allowlist.mjs --out <allowlist.json> --reason <text> <run dir> [<run dir> ...]');
    process.exit(2);
}

const runs = argv.map((dir) => {
    const merged = {};
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        for (const [key, screens] of Object.entries(JSON.parse(readFileSync(join(dir, file), 'utf8')))) {
            merged[key] = { ...(merged[key] || {}), ...screens };
        }
    }
    return merged;
});
const allowlist = seedAllowlist(runs, reason);
writeFileSync(out, `${JSON.stringify(allowlist, null, 4)}\n`);
const total = Object.values(allowlist).reduce((n, e) => n + Object.keys(e.screens).length, 0);
console.log(`${out}: ${total} entries over ${Object.keys(allowlist).length} keys from ${runs.length} runs`);
