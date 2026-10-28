#!/usr/bin/env node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRecordedProcess, stopRecordedProcess } from './lane-pid.mjs';
import { httpCondition, waitUntil } from './wait-for.mjs';

const SUITES = new Set(['unit', 'smoke', 'regression', 'e2e']);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function usage(message) {
    const detail = message ? `${message}\n` : '';
    return `${detail}usage: run-suite.mjs --suite <unit|smoke|regression|e2e> [--files <file...>] --out <dir> [--port <n>]`;
}

export function parseSuiteArgs(argv) {
    const options = { files: [] };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--files') {
            i += 1;
            while (i < argv.length && !argv[i].startsWith('--')) {
                options.files.push(argv[i]);
                i += 1;
            }
            i -= 1;
            continue;
        }
        if (!['--suite', '--out', '--port'].includes(arg)) throw new Error(usage(`unknown argument: ${arg}`));
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) throw new Error(usage(`${arg} requires a value`));
        options[arg.slice(2)] = value;
        i += 1;
    }
    if (!SUITES.has(options.suite)) throw new Error(usage('--suite is required'));
    if (!options.out) throw new Error(usage('--out is required'));
    if (options.suite === 'e2e') {
        const port = Number(options.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error(usage('e2e requires --port from 1 to 65535'));
        }
        options.port = port;
    } else if (options.port !== undefined) {
        throw new Error(usage('--port is only valid for e2e'));
    }
    options.out = resolve(options.out);
    return options;
}

function stripAnsi(text) {
    return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

export function parseRunnerSummary(rawOutput) {
    const output = stripAnsi(String(rawOutput));
    const counts = { pass: 0, fail: 0, skipped: 0 };
    const vitestLine = output.split(/\r?\n/).findLast((line) => /^\s*Tests\s+/i.test(line));
    if (vitestLine) {
        for (const match of vitestLine.matchAll(/(\d+)\s+(passed|failed|skipped)/gi)) {
            const key = { passed: 'pass', failed: 'fail', skipped: 'skipped' }[match[2].toLowerCase()];
            counts[key] = Number(match[1]);
        }
        return counts;
    }

    const smoke = output.match(/(\d+)\s+smoke\(s\) passed\s*\/\s*(\d+)\s+skipped/i);
    if (smoke) {
        counts.pass = Number(smoke[1]);
        counts.skipped = Number(smoke[2]);
        const failed = [...output.matchAll(/(\d+)\s*\/\s*\d+\s+smoke\(s\) failed/gi)].at(-1);
        if (failed) counts.fail = Number(failed[1]);
        return counts;
    }

    for (const line of output.split(/\r?\n/)) {
        const match = line.match(/^\s*(\d+)\s+(passed|failed|skipped)(?:\s|$)/i);
        if (!match) continue;
        const key = { passed: 'pass', failed: 'fail', skipped: 'skipped' }[match[2].toLowerCase()];
        counts[key] = Number(match[1]);
    }
    return counts;
}

function pnpmCommand() {
    return process.env.XCHAIN_SWEEP_PNPM || 'pnpm';
}

function suiteProcess(options, repoRoot, smokeFile) {
    const command = smokeFile ? process.execPath : pnpmCommand();
    const args = smokeFile ? [smokeFile] : ['run', `test:${options.suite}`, ...options.files];
    const env = { ...process.env };
    if (options.suite === 'e2e') {
        env.E2E_DEV_PORT = String(options.port);
        env.XCHAIN_SWEEP_EXTERNAL_SERVER = '1';
    }
    return startRecordedProcess(options.suite, {
        dir: options.out,
        command,
        args,
        cwd: repoRoot,
        env,
    });
}

async function waitForExit(child) {
    if (child.exitCode !== null) return child.exitCode;
    return new Promise((done, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => done(code ?? 1));
    });
}

async function startE2eServer(options, repoRoot) {
    const server = startRecordedProcess('e2e-server', {
        dir: options.out,
        command: pnpmCommand(),
        args: [
            '-C', 'packages/web', 'dev', '--port', String(options.port),
            '--strictPort', '--host', '127.0.0.1',
        ],
        cwd: repoRoot,
        env: { ...process.env, VITE_XCHAIN_REAL_SDK: '0' },
    });
    const ready = waitUntil(httpCondition(`http://127.0.0.1:${options.port}/`), 120_000);
    const exited = new Promise((resolveReady, reject) => {
        server.child.once('exit', (code) => reject(new Error(`e2e dev server exited with code ${code ?? 1}`)));
        server.child.once('error', reject);
    });
    try {
        if (!await Promise.race([ready, exited])) {
            throw new Error('e2e dev server did not become ready within 120 seconds');
        }
        return server;
    } catch (error) {
        await stopRecordedProcess('e2e-server', { dir: options.out });
        throw error;
    }
}

function writeSummary(out, summary) {
    const finalPath = join(out, 'summary.json');
    const temporaryPath = join(out, `.summary-${process.pid}.json`);
    writeFileSync(temporaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    renameSync(temporaryPath, finalPath);
}

export async function runSuite(options, { repoRoot = REPO_ROOT } = {}) {
    mkdirSync(options.out, { recursive: true });
    let server;
    let output = '';
    let exitCode = 2;
    let counts;
    let operationalError;
    let stopError;
    try {
        if (options.suite === 'e2e') server = await startE2eServer(options, repoRoot);
        if (options.suite === 'smoke' && options.files.length > 0) {
            counts = { pass: 0, fail: 0, skipped: 0 };
            exitCode = 0;
            for (const file of options.files) {
                const suite = suiteProcess(options, repoRoot, file);
                const fileExitCode = await waitForExit(suite.child);
                output += readFileSync(suite.logPath, 'utf8');
                if (fileExitCode === 0) {
                    counts.pass += 1;
                } else {
                    counts.fail += 1;
                    if (exitCode === 0) exitCode = fileExitCode;
                }
            }
        } else {
            const suite = suiteProcess(options, repoRoot);
            exitCode = await waitForExit(suite.child);
            output = readFileSync(suite.logPath, 'utf8');
        }
    } catch (error) {
        operationalError = error.message || String(error);
    } finally {
        if (server) {
            try {
                await stopRecordedProcess('e2e-server', { dir: options.out });
            } catch (error) {
                stopError = error.message || String(error);
            }
        }
    }

    counts ??= parseRunnerSummary(output);
    if (exitCode !== 0 || operationalError || stopError) counts.fail = Math.max(1, counts.fail);
    if ((operationalError || stopError) && exitCode === 0) exitCode = 2;
    const summary = {
        suite: options.suite,
        pass: counts.pass,
        fail: counts.fail,
        skipped: counts.skipped,
        exitCode,
        finishedAt: new Date().toISOString(),
        ...(operationalError ? { error: operationalError } : {}),
        ...(stopError ? { stopError } : {}),
    };
    writeSummary(options.out, summary);
    return summary;
}

async function main() {
    let options;
    try {
        options = parseSuiteArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error.message || error);
        process.exitCode = 2;
        return;
    }
    const summary = await runSuite(options);
    console.log(JSON.stringify(summary));
    if (summary.exitCode !== 0 || summary.fail > 0) process.exitCode = summary.exitCode || 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
    await main();
}
