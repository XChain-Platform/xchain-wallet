// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// testnet_evidence: read the Playwright JSON report a testnet run leaves in
// test-results-testnet/results.json and print what it proved.
//
// The report nests suites inside suites, and the on-chain transaction ids are
// carried as annotations of type txid, each described as a label (funding,
// stake, unstake or collect), one space and the 64 hex characters of the id.
// summarizeRun flattens that tree in report order; main prints one line per
// test with its ids indented below it and exits 0 only for a clean run that
// holds every required id label. Nothing here prints a key, a phrase or an
// address.

import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORT = path.resolve(HERE, '..', 'test-results-testnet', 'results.json');
const TXID_PATTERN = /^(funding|stake|unstake|collect) ([0-9a-f]{64})$/;

export const REQUIRED_TXID_LABELS = Object.freeze(['funding', 'stake', 'unstake', 'collect']);

function collectTxids(annotations, file, title, seen, out) {
    for (const annotation of annotations || []) {
        if (!annotation || annotation.type !== 'txid') continue;
        const match = TXID_PATTERN.exec(String(annotation.description));
        if (!match) {
            throw new Error(`malformed txid annotation in ${file}: ${title}`);
        }
        const key = `${match[1]} ${match[2]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ label: match[1], txid: match[2] });
    }
}

function walkSuites(suites, tests) {
    for (const suite of suites || []) {
        for (const spec of suite.specs || []) {
            for (const test of spec.tests || []) {
                const file = spec.file || suite.file || '';
                const title = spec.title;
                const seen = new Set();
                const txids = [];
                collectTxids(test.annotations, file, title, seen, txids);
                for (const result of test.results || []) {
                    collectTxids(result.annotations, file, title, seen, txids);
                }
                tests.push({ file, title, status: test.status, txids });
            }
        }
        walkSuites(suite.suites, tests);
    }
}

export function summarizeRun(report) {
    const tests = [];
    walkSuites(report && report.suites, tests);
    const errors = report && Array.isArray(report.errors) ? report.errors.length : 0;
    return { errors, tests };
}

export async function main({
    argv = process.argv.slice(2),
    readFile = fs.readFile,
    stdout = process.stdout,
    stderr = process.stderr,
} = {}) {
    const target = argv[0] || DEFAULT_REPORT;
    let report;
    try {
        report = JSON.parse(await readFile(target, 'utf8'));
    } catch (err) {
        stderr.write(`cannot read testnet report ${target}\n`);
        return 2;
    }
    const { errors, tests } = summarizeRun(report);
    let txidCount = 0;
    const txidLabels = new Set();
    for (const test of tests) {
        stdout.write(`${test.status} ${test.file} ${test.title}\n`);
        for (const { label, txid } of test.txids) {
            stdout.write(`  ${label} ${txid}\n`);
            txidCount += 1;
            txidLabels.add(label);
        }
    }
    const missingTxidLabels = REQUIRED_TXID_LABELS.filter((label) => !txidLabels.has(label));
    const passed = errors === 0
        && tests.length > 0
        && tests.every((t) => t.status === 'expected')
        && txidCount > 0
        && missingTxidLabels.length === 0;
    if (missingTxidLabels.length > 0) {
        stdout.write(`missing txid: ${missingTxidLabels.join(', ')}\n`);
    }
    stdout.write(passed ? 'testnet run passed\n' : 'testnet run failed\n');
    return passed ? 0 : 1;
}

function invokedDirectly() {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
}
if (invokedDirectly()) {
    process.exitCode = await main();
}
