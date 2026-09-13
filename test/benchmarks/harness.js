// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Tiny benchmark harness. Invokes every `*.bench.js` file under
// scenarios/ and reports median + p95 timings.
//
//   node test/benchmarks/harness.js              # full
//   node test/benchmarks/harness.js --quick      # cap iterations
//   node test/benchmarks/harness.js --scenario kdf
//   node test/benchmarks/harness.js --save-baseline
//   node test/benchmarks/harness.js --compare

import { readdirSync, statSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const here = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = join(here, 'scenarios');
const BASELINES_DIR = join(here, 'baselines');
if (!existsSync(BASELINES_DIR)) mkdirSync(BASELINES_DIR);

const argv = process.argv.slice(2);
const QUICK = argv.includes('--quick');
const SAVE = argv.includes('--save-baseline');
const COMPARE = argv.includes('--compare');
const SCENARIO_IDX = argv.indexOf('--scenario');
const SCENARIO_FILTER = SCENARIO_IDX >= 0 ? argv[SCENARIO_IDX + 1] : null;

function listScenarios() {
    return readdirSync(SCENARIOS_DIR)
        .filter((n) => n.endsWith('.bench.js'))
        .filter((n) => !SCENARIO_FILTER || n.includes(SCENARIO_FILTER))
        .sort();
}

function median(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}
function pct(arr, p) {
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

export async function run(label, fn, iterations) {
    const N = QUICK ? Math.max(5, Math.floor(iterations / 10)) : iterations;
    // Warm-up
    await fn();
    const samples = [];
    for (let i = 0; i < N; i += 1) {
        const t0 = performance.now();
        await fn();
        samples.push(performance.now() - t0);
    }
    return {
        label,
        n: N,
        medianMs: median(samples),
        p95Ms: pct(samples, 0.95),
    };
}

const allResults = [];
for (const file of listScenarios()) {
    const mod = await import(join(SCENARIOS_DIR, file));
    if (typeof mod.runScenario !== 'function') {
        console.error(`× ${file} does not export runScenario`);
        continue;
    }
    const results = await mod.runScenario(run);
    for (const r of results) {
        const out = `${file.replace('.bench.js', '')} :: ${r.label}: median=${r.medianMs.toFixed(2)}ms p95=${r.p95Ms.toFixed(2)}ms (n=${r.n})`;
        console.log(out);
        allResults.push({ scenario: file, ...r });
    }
}

if (SAVE) {
    const path = join(BASELINES_DIR, 'baseline.json');
    writeFileSync(path, JSON.stringify(allResults, null, 2));
    console.log(`\nbaseline saved to ${path}`);
}

if (COMPARE) {
    const path = join(BASELINES_DIR, 'baseline.json');
    if (!existsSync(path)) {
        console.error('no baseline; run with --save-baseline first');
        process.exit(2);
    }
    const baseline = JSON.parse(readFileSync(path, 'utf8'));
    let regressions = 0;
    for (const r of allResults) {
        const b = baseline.find((x) => x.scenario === r.scenario && x.label === r.label);
        if (!b) continue;
        const delta = (r.medianMs - b.medianMs) / b.medianMs;
        if (delta > 0.30) {
            console.error(`REGRESSION ${r.scenario}/${r.label}: +${(delta * 100).toFixed(1)}% (was ${b.medianMs.toFixed(2)}ms, now ${r.medianMs.toFixed(2)}ms)`);
            regressions += 1;
        }
    }
    if (regressions > 0) process.exit(1);
}
