// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Layout sweep in the browser venues: one run per project in
// playwright.layout.config.js (Chromium at Android phone sizes, WebKit at
// iPhone and iPad sizes). Results land in tmp/layout-sweep/<project>/.
// LAYOUT_SCHEME=dark (see the config) runs the same walk in the dark palette,
// adds the contrast and light-surface measurements, and writes to
// tmp/dark-sweep/<project>/ instead.

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../fixtures/wallet.js';
import { createSweep, layoutSweepFailures } from './sweep.js';

const DARK = process.env.LAYOUT_SCHEME === 'dark';
const OUT_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'tmp', DARK ? 'dark-sweep' : 'layout-sweep');

test('layout gutter assertion contract', () => {
    const layout = (gutter, kind = 'list', topGap = 16) => ({
        contentLeft: gutter,
        contentRightGap: gutter,
        headerLeft: gutter,
        first: { kind, left: gutter, rightGap: gutter, topGap },
    });
    expect(layoutSweepFailures([
        { label: 'scaled', vw: 411, layout: layout(12), rootFontPx: 24, expectedRootFontPx: 24 },
        { label: 'lost scale', vw: 411, layout: layout(12), rootFontPx: 16, expectedRootFontPx: 24 },
        { label: 'unread', vw: 411, layout: layout(12), expectedRootFontPx: 20.8 },
    ])).toEqual([
        'lost scale: root font size 16px, expected 24px',
        'unread: root font size unread, expected 20.8px',
    ]);
    // One 12px page gutter at every width.
    expect(layoutSweepFailures([
        { label: 'compact', vw: 639, layout: layout(12) },
        { label: 'rail', vw: 834, layout: layout(12) },
        { label: 'full', vw: 1280, layout: layout(12) },
    ])).toEqual([]);
    expect(layoutSweepFailures([
        { label: 'old rail gutter', vw: 834, layout: layout(16) },
    ])).toEqual([
        'old rail gutter: content left 16px, expected 12px',
        'old rail gutter: header left 16px, expected 12px',
        'old rail gutter: first content left 16px, expected 12px',
    ]);
    // A wide step that centres its column passes; one pushed off-centre does not.
    const column = (left, rightGap) => ({
        contentLeft: 12, contentRightGap: 12, headerLeft: null, first: { kind: 'list', left, rightGap, topGap: 12 },
    });
    expect(layoutSweepFailures([
        { label: 'centred', vw: 834, layout: column(177, 177) },
        { label: 'off centre', vw: 834, layout: column(177, 60) },
        { label: 'narrow centred', vw: 411, layout: column(40, 40) },
    ])).toEqual([
        'off centre: first content left 177px, expected 12px',
        'narrow centred: first content left 40px, expected 12px',
    ]);
    expect(layoutSweepFailures([
        {
            label: 'activity',
            vw: 768,
            layout: {
                contentLeft: 12,
                contentRightGap: 9,
                headerLeft: 18,
                first: { kind: 'list', left: 9, rightGap: 8, topGap: 12 },
            },
        },
        {
            label: 'send',
            vw: 768,
            layout: {
                contentLeft: 12,
                contentRightGap: 12,
                headerLeft: 12,
                first: { kind: 'form', left: 104, rightGap: 104, topGap: 16 },
            },
        },
    ])).toEqual([
        'activity: content right gap 9px, expected at least 12px',
        'activity: header left 18px, expected 12px',
        'activity: first content left 9px, expected 12px',
        'activity: first content right gap 8px, expected at least 12px',
        'form top gaps [16] do not match list top gaps [12]',
    ]);
});

test('layout sweep', async ({ page }, testInfo) => {
    test.setTimeout(45 * 60 * 1000);
    const venue = testInfo.project.name;
    const screens = [];
    const sweep = createSweep(page, {
        venue,
        outDir: join(OUT_ROOT, venue),
        fontScale: testInfo.project.metadata?.fontScale,
        contrast: DARK,
        onResult: (result) => screens.push(result),
    });
    await sweep.onboarding();
    await sweep.unlocked();
    expect(layoutSweepFailures(screens), 'every measured route follows the page gutter contract').toEqual([]);
});
