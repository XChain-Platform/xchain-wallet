// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { statusRecordedProcess } from '../../../tools/sweep/lane-pid.mjs';
import { parseRunnerSummary } from '../../../tools/sweep/run-suite.mjs';

const SOURCE_DIR = path.resolve('tools/sweep');

function fixture() {
    const root = mkdtempSync(path.join(tmpdir(), 'run-suite-'));
    const toolDir = path.join(root, 'tools', 'sweep');
    const webDir = path.join(root, 'packages', 'web');
    const smokeDir = path.join(root, 'test', 'smoke');
    mkdirSync(toolDir, { recursive: true });
    mkdirSync(webDir, { recursive: true });
    mkdirSync(smokeDir, { recursive: true });
    for (const name of ['lane-pid.mjs', 'run-suite.mjs', 'wait-for.mjs']) {
        copyFileSync(path.join(SOURCE_DIR, name), path.join(toolDir, name));
    }
    writeFileSync(path.join(root, 'unit.mjs'), `
console.log(JSON.stringify(process.argv.slice(2)));
console.log(' Tests  2 passed | 1 skipped (3)');
`);
    writeFileSync(path.join(root, 'regression.mjs'), "console.log(' Tests  1 failed | 2 passed (3)'); process.exitCode = 1;\n");
    writeFileSync(path.join(smokeDir, '_run-smokes.js'), `
require('node:fs').writeFileSync('whole-smoke-suite-ran', 'yes');
console.log('1 smoke(s) passed / 0 skipped');
`);
    writeFileSync(path.join(smokeDir, 'alpha.smoke.js'), `
require('node:fs').writeFileSync('alpha-smoke-ran', 'yes');
process.exitCode = 1;
`);
    writeFileSync(path.join(smokeDir, 'beta.smoke.js'), `
require('node:fs').writeFileSync('beta-smoke-ran', 'yes');
`);
    writeFileSync(path.join(root, 'e2e.mjs'), `
const response = await fetch('http://127.0.0.1:' + process.env.E2E_DEV_PORT + '/');
if (!response.ok) process.exitCode = 1;
console.log(response.ok ? '  1 passed (100ms)' : '  1 failed');
`);
    writeFileSync(path.join(webDir, 'server.mjs'), `
import http from 'node:http';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const server = http.createServer((request, response) => { response.writeHead(204); response.end(); });
server.listen(port, '127.0.0.1');
`);
    writeFileSync(path.join(webDir, 'package.json'), `${JSON.stringify({
        private: true,
        scripts: { dev: 'node server.mjs' },
    }, null, 2)}\n`);
    writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
        private: true,
        scripts: {
            'test:unit': 'node unit.mjs',
            'test:smoke': 'node test/smoke/_run-smokes.js',
            'test:regression': 'node regression.mjs',
            'test:e2e': 'node e2e.mjs',
        },
    }, null, 2)}\n`);
    return { root, tool: path.join(toolDir, 'run-suite.mjs') };
}

function run(tool, args) {
    return spawnSync(process.execPath, [tool, ...args], {
        encoding: 'utf8',
        timeout: 15_000,
        env: process.env,
    });
}

function unusedPort() {
    const server = net.createServer();
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

describe('run-suite', () => {
    it('parses Vitest, smoke, and Playwright summaries', () => {
        expect(parseRunnerSummary(' Tests  2 failed | 8 passed | 1 skipped (11)')).toEqual({
            pass: 8, fail: 2, skipped: 1,
        });
        expect(parseRunnerSummary('10 smoke(s) passed / 2 skipped\n1 / 13 smoke(s) failed')).toEqual({
            pass: 10, fail: 1, skipped: 2,
        });
        expect(parseRunnerSummary('  1 failed\n  7 passed (2s)\n  2 skipped')).toEqual({
            pass: 7, fail: 1, skipped: 2,
        });
    });

    it('runs a green suite detached and writes its recorded summary', () => {
        const { root, tool } = fixture();
        const out = path.join(root, 'results-unit');
        const result = run(tool, ['--suite', 'unit', '--out', out]);
        const summary = JSON.parse(readFileSync(path.join(out, 'summary.json'), 'utf8'));

        expect(result.status).toBe(0);
        expect(summary).toMatchObject({ suite: 'unit', pass: 2, fail: 0, skipped: 1, exitCode: 0 });
        expect(JSON.parse(readFileSync(path.join(out, 'unit.pid'), 'utf8'))).toMatchObject({
            pid: expect.any(Number), pgid: expect.any(Number),
        });
    });

    it('passes unit file filters without an argument separator', () => {
        const { root, tool } = fixture();
        const out = path.join(root, 'results-unit-files');
        const result = run(tool, [
            '--suite', 'unit', '--files', 'alpha.test.js', 'beta.test.js', '--out', out,
        ]);
        const argvLine = readFileSync(path.join(out, 'unit.log'), 'utf8')
            .split(/\r?\n/).find((line) => line.startsWith('["'));

        expect(result.status).toBe(0);
        expect(JSON.parse(argvLine)).toEqual(['alpha.test.js', 'beta.test.js']);
    });

    it('runs named smoke files directly and counts their exit codes', () => {
        const { root, tool } = fixture();
        const out = path.join(root, 'results-smoke-files');
        const result = run(tool, [
            '--suite', 'smoke', '--files',
            'test/smoke/alpha.smoke.js', 'test/smoke/beta.smoke.js', '--out', out,
        ]);
        const summary = JSON.parse(readFileSync(path.join(out, 'summary.json'), 'utf8'));

        expect(result.status).toBe(1);
        expect(summary).toMatchObject({ suite: 'smoke', pass: 1, fail: 1, skipped: 0, exitCode: 1 });
        expect(readFileSync(path.join(root, 'alpha-smoke-ran'), 'utf8')).toBe('yes');
        expect(readFileSync(path.join(root, 'beta-smoke-ran'), 'utf8')).toBe('yes');
        expect(existsSync(path.join(root, 'whole-smoke-suite-ran'))).toBe(false);
    });

    it('returns non-zero and records failures for a red suite', () => {
        const { root, tool } = fixture();
        const out = path.join(root, 'results-red');
        const result = run(tool, ['--suite', 'regression', '--out', out]);
        const summary = JSON.parse(readFileSync(path.join(out, 'summary.json'), 'utf8'));

        expect(result.status).toBe(1);
        expect(summary).toMatchObject({ suite: 'regression', pass: 2, fail: 1, skipped: 0, exitCode: 1 });
    });

    it('starts and stops its recorded e2e dev server', async () => {
        const { root, tool } = fixture();
        const out = path.join(root, 'results-e2e');
        const port = await unusedPort();
        const result = run(tool, [
            '--suite', 'e2e', '--out', out, '--port', String(port),
        ]);
        const summary = JSON.parse(readFileSync(path.join(out, 'summary.json'), 'utf8'));

        expect(result.status).toBe(0);
        expect(summary).toMatchObject({ suite: 'e2e', pass: 1, fail: 0, skipped: 0, exitCode: 0 });
        expect(statusRecordedProcess('e2e-server', out)).toMatchObject({
            state: 'stopped', running: false,
        });
    });
});
