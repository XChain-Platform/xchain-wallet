// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Discovers every `*.smoke.js` under this directory (recursively) and
// runs them sequentially. Exits non-zero on the first failure.
//
// Each smoke is a standalone Node script that exercises a thin slice
// of wiring (no Vitest, no jsdom). The runner stays small on purpose
// so dropping a new `*.smoke.js` into any subdirectory is enough to
// pick it up; no manifest to update.
//
// `cwd` for spawned smokes is the wallet repo root so smokes that
// read project files via relative paths get a stable base.

import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));        // .../test/smoke
const wsRoot = join(here, '..', '..');                        // .../xchain-wallet

function* walkSmokes(dir) {
    for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
            yield* walkSmokes(full);
        } else if (name.endsWith('.smoke.js')) {
            yield full;
        }
    }
}

const smokes = [...walkSmokes(here)];

let failures = 0;
for (const fullPath of smokes) {
    const display = fullPath.slice(here.length + 1);
    const start = Date.now();
    const result = spawnSync(process.execPath, [fullPath], {
        stdio: 'inherit',
        cwd: wsRoot,
    });
    const ms = Date.now() - start;
    if (result.status !== 0) {
        failures += 1;
        console.error(`FAIL ${display} (${ms}ms, exit ${result.status})`);
    }
}

if (failures > 0) {
    console.error(`\n${failures} / ${smokes.length} smoke(s) failed`);
    process.exit(1);
}
console.log(`\n${smokes.length} smoke(s) passed`);
