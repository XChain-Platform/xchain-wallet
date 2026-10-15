// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { join } from 'node:path';
import pngjs from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
    buildReportIndex,
    diffPngBuffers,
    parseArgs,
    pick,
    SCREENS,
    screenSelected,
    SIZES,
} from '../../scripts/visual-compare.mjs';
import { VISUAL_REPORT_GENERATOR } from '../../scripts/visual-report-files.mjs';

const { PNG } = pngjs;

function pngBuffer(width, height, colors) {
    const png = new PNG({ width, height });
    colors.forEach((color, index) => {
        png.data.set(color, index * 4);
    });
    return PNG.sync.write(png);
}

describe('visual compare argument and target selection', () => {
    it('parses valued and boolean arguments while ignoring positional input', () => {
        expect(parseArgs([
            'ignored', '--baseline', '/base', '--keep-all', '--screens', 'home,settings', '--out', '/report',
        ])).toEqual({
            baseline: '/base',
            'keep-all': true,
            screens: 'home,settings',
            out: '/report',
        });
    });

    it('selects sizes and screens by comma-separated prefixes', () => {
        expect(pick(SIZES, ' phone, desktop-1460').map((size) => size.name)).toEqual([
            'phone-412x869',
            'desktop-1460x920',
        ]);
        expect(pick(SCREENS, 'send,set').map((screen) => screen.key)).toEqual(['send', 'settings']);
        expect(screenSelected('settings', 'home, set')).toBe(true);
        expect(screenSelected('history', 'home, set')).toBe(false);
        expect(screenSelected('history', true)).toBe(true);
    });
});

describe('visual compare PNG diffing', () => {
    it('honors the channel tolerance using fixture PNG buffers', () => {
        const baseline = pngBuffer(2, 1, [[10, 10, 10, 255], [20, 20, 20, 255]]);
        const candidate = pngBuffer(2, 1, [[34, 10, 10, 255], [45, 20, 20, 255]]);

        const result = diffPngBuffers(baseline, candidate, 24);
        const diff = PNG.sync.read(result.image);

        expect(result.percent).toBe(50);
        expect(result.sizeMismatch).toBe(false);
        expect([...diff.data.slice(4, 8)]).toEqual([230, 20, 40, 255]);
    });

    it('counts pixels outside the smaller image as changed', () => {
        const onePixel = pngBuffer(1, 1, [[10, 10, 10, 255]]);
        const twoPixels = pngBuffer(2, 1, [[10, 10, 10, 255], [10, 10, 10, 255]]);

        const result = diffPngBuffers(onePixel, twoPixels);

        expect(result.percent).toBe(50);
        expect(result.sizeMismatch).toBe(true);
    });
});

describe('visual report index generation', () => {
    it('records the generator marker and relative image paths', () => {
        const outDir = join('/tmp', 'visual-report-fixture');
        const skipped = [{ side: 'candidate', size: 'phone-412x869', screen: 'send', why: 'fixture' }];
        const index = buildReportIndex([{
            screen: 'home',
            size: 'phone-412x869',
            phase: 'top',
            percent: 0.25,
            status: 'ok',
            pruned: true,
            baseline: join(outDir, 'shots', 'baseline.png'),
            candidate: join(outDir, 'shots', 'candidate.png'),
            diff: join(outDir, 'diff', 'home.png'),
            baselineMetrics: { docScrollX: 0, docScrollY: 0 },
            candidateMetrics: { docScrollX: 0, docScrollY: 0 },
            note: 'fixture note',
        }], skipped, {
            generator: VISUAL_REPORT_GENERATOR,
            baseline: '/base',
            candidate: '/candidate',
        }, {
            outDir,
            tolerance: 24,
            sizeNames: ['phone-412x869'],
        });

        expect(VISUAL_REPORT_GENERATOR).toBe('visual-compare');
        expect(index.generator).toBe('visual-compare');
        expect(index.tolerance).toBe(24);
        expect(index.sizes).toEqual(['phone-412x869']);
        expect(index.rows[0]).toMatchObject({
            pruned: true,
            baseline: join('shots', 'baseline.png'),
            candidate: join('shots', 'candidate.png'),
            diff: join('diff', 'home.png'),
        });
        expect(index.skipped).toBe(skipped);
    });
});
