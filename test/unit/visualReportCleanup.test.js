// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { spawnSync } from 'node:child_process';
import {
    existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    pruneReportRows, VISUAL_REPORT_GENERATOR,
} from '../../scripts/visual-report-files.mjs';

const SCRIPT = join(process.cwd(), 'scripts', 'visual-clean.mjs');
const fixtures = [];

function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'visual-clean-'));
    fixtures.push(dir);
    return dir;
}

function metrics(overrides = {}) {
    return {
        docScrollX: 0,
        docScrollY: 120,
        header: { top: 0, h: 48, w: 360 },
        scrollers: ['main.content:120'],
        ...overrides,
    };
}

function makeReport(root, name, { marker = true, ageHours = 48 } = {}) {
    const dir = join(root, name);
    mkdirSync(join(dir, 'shots'), { recursive: true });
    writeFileSync(join(dir, 'shots', 'capture.png'), 'fixture png bytes');
    writeFileSync(join(dir, 'index.json'), JSON.stringify({
        generator: marker ? VISUAL_REPORT_GENERATOR : 'some-other-tool',
        finishedAt: new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString(),
    }));
    const when = new Date(Date.now() - ageHours * 60 * 60 * 1000);
    utimesSync(dir, when, when);
    return dir;
}

afterEach(() => {
    for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('visual report pruning', () => {
    it('deletes only below-threshold rows with matching layout metrics', () => {
        const root = fixture();
        const files = ['baseline.png', 'candidate.png', 'diff.png'].map((name) => join(root, name));
        for (const file of files) writeFileSync(file, 'png');
        const mismatch = join(root, 'mismatch.png');
        const atThreshold = join(root, 'at-threshold.png');
        writeFileSync(mismatch, 'png');
        writeFileSync(atThreshold, 'png');
        const rows = [
            {
                percent: 0.499, baseline: files[0], candidate: files[1], diff: files[2],
                baselineMetrics: metrics(), candidateMetrics: metrics(),
            },
            {
                percent: 0.1, baseline: mismatch,
                baselineMetrics: metrics(), candidateMetrics: metrics({ header: { h: 49 } }),
            },
            {
                percent: 0.5, baseline: atThreshold,
                baselineMetrics: metrics(), candidateMetrics: metrics(),
            },
        ];

        const result = pruneReportRows(rows, { threshold: 0.5 });

        expect(result.pruned).toBe(1);
        expect(rows[0].pruned).toBe(true);
        expect(files.every((file) => !existsSync(file))).toBe(true);
        expect(rows[1].pruned).toBe(false);
        expect(existsSync(mismatch)).toBe(true);
        expect(rows[2].pruned).toBe(false);
        expect(existsSync(atThreshold)).toBe(true);
        expect(result.retained).toEqual([mismatch, atThreshold]);
    });

    it('retains below-threshold rows when keep-all is set', () => {
        const root = fixture();
        const file = join(root, 'kept.png');
        writeFileSync(file, 'png');
        const rows = [{
            percent: 0, baseline: file,
            baselineMetrics: metrics(), candidateMetrics: metrics(),
        }];

        const result = pruneReportRows(rows, { keepAll: true });

        expect(result.pruned).toBe(0);
        expect(rows[0].pruned).toBe(false);
        expect(existsSync(file)).toBe(true);
    });
});

describe('visual report cleanup command', () => {
    it('removes only old marked reports and reports their freed bytes', () => {
        const root = fixture();
        const oldReport = makeReport(root, 'old');
        const freshReport = makeReport(root, 'fresh', { ageHours: 1 });
        const unrelated = makeReport(root, 'unrelated', { marker: false });

        const result = spawnSync(process.execPath, [SCRIPT, '--root', root, '--max-age-hours', '24'], {
            encoding: 'utf8',
        });

        expect(result.status).toBe(0);
        expect(existsSync(oldReport)).toBe(false);
        expect(existsSync(freshReport)).toBe(true);
        expect(existsSync(unrelated)).toBe(true);
        expect(result.stdout).toMatch(/removed .*\/old: \d+ bytes freed/);
        expect(result.stdout).toContain('1 report directory removed');

        const removeAll = spawnSync(process.execPath, [SCRIPT, '--root', root, '--all'], { encoding: 'utf8' });
        expect(removeAll.status).toBe(0);
        expect(existsSync(freshReport)).toBe(false);
        expect(existsSync(unrelated)).toBe(true);
        expect(JSON.parse(readFileSync(join(unrelated, 'index.json'), 'utf8')).generator).toBe('some-other-tool');
    });

    it('refuses a root outside temporary storage', () => {
        const result = spawnSync(process.execPath, [SCRIPT, '--root', '/var/xchain-visual-clean-refusal'], {
            encoding: 'utf8',
        });

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('refusing root outside a tmp directory');
    });
});
