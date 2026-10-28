// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
    startRecordedProcess, statusRecordedProcess, stopRecordedProcess,
} from '../../../tools/sweep/lane-pid.mjs';

const TOOL = path.resolve('tools/sweep/lane-pid.mjs');

describe('lane-pid', () => {
    it('records and stops only its detached process group', async () => {
        const root = mkdtempSync(path.join(tmpdir(), 'lane-pid-'));
        const started = startRecordedProcess('worker', {
            dir: root,
            command: process.execPath,
            args: ['-e', 'setInterval(() => {}, 1000)'],
        });
        const exited = once(started.child, 'exit');
        const record = JSON.parse(readFileSync(path.join(root, 'worker.pid'), 'utf8'));

        expect(record).toMatchObject({ pid: started.pid, pgid: started.pid });
        expect(statusRecordedProcess('worker', root)).toMatchObject({ state: 'running', running: true });

        await stopRecordedProcess('worker', { dir: root, graceMs: 500 });
        await exited;

        expect(statusRecordedProcess('worker', root)).toMatchObject({ state: 'stopped', running: false });
        expect(readFileSync(path.join(root, 'worker.log'), 'utf8')).toBe('');
    });

    it('refuses to stop without a pid file', async () => {
        const root = mkdtempSync(path.join(tmpdir(), 'lane-pid-missing-'));

        await expect(stopRecordedProcess('absent', { dir: root })).rejects.toThrow(/pid file is missing/);

        const result = spawnSync(process.execPath, [TOOL, 'stop', 'absent', '--dir', root], {
            encoding: 'utf8',
        });
        expect(result.status).toBe(2);
        expect(result.stderr).toContain('refusing to stop absent');
    });

    it('reports a missing status without creating a pid file', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'lane-pid-status-'));
        const result = spawnSync(process.execPath, [TOOL, 'status', 'worker', '--dir', root], {
            encoding: 'utf8',
        });

        expect(result.status).toBe(1);
        expect(result.stdout.trim()).toBe('worker missing');
    });
});
