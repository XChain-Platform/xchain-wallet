// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
    fileCondition, httpCondition, portCondition, waitUntil,
} from '../../../tools/sweep/wait-for.mjs';

const TOOL = path.resolve('tools/sweep/wait-for.mjs');
const servers = [];

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

describe('wait-for', () => {
    it('waits for a file to contain the requested text', async () => {
        const root = mkdtempSync(path.join(tmpdir(), 'wait-for-file-'));
        const target = path.join(root, 'ready.txt');
        setTimeout(() => writeFileSync(target, 'service ready\n'), 25);

        await expect(waitUntil(fileCondition(target, 'ready'), 1000, 10)).resolves.toBe(true);
    });

    it('detects a loopback port and an HTTP 2xx response', async () => {
        const tcp = net.createServer();
        servers.push(tcp);
        const port = await listen(tcp);

        const web = http.createServer((request, response) => {
            response.writeHead(request.url === '/ready' ? 204 : 503);
            response.end();
        });
        servers.push(web);
        const httpPort = await listen(web);

        await expect(waitUntil(portCondition(port), 1000, 10)).resolves.toBe(true);
        await expect(waitUntil(httpCondition(`http://127.0.0.1:${httpPort}/ready`), 1000, 10)).resolves.toBe(true);
        await expect(waitUntil(httpCondition(`http://127.0.0.1:${httpPort}/not-ready`), 30, 10)).resolves.toBe(false);
    });

    it('exits 124 with one timeout line naming the awaited condition', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'wait-for-timeout-'));
        const target = path.join(root, 'missing.txt');
        const result = spawnSync(process.execPath, [
            TOOL, '--file', target, '--contains', 'done', '--timeout', '0.02',
        ], { encoding: 'utf8' });

        expect(result.status).toBe(124);
        expect(result.stdout).toBe('');
        expect(result.stderr.trim().split(/\r?\n/)).toEqual([
            `timed out after 0.02s waiting for file ${target} containing "done"`,
        ]);
    });

    it('requires exactly one mode and a timeout', () => {
        const result = spawnSync(process.execPath, [TOOL, '--port', '1234'], { encoding: 'utf8' });

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('--timeout is required');
    });
});
