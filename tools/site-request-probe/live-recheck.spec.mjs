// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { parseProbeLog, summarizeReturn } from './probe-log.mjs';
import { buildRuns } from './probe-report.mjs';

const LIVE_PAGE = 'https://dankest.llc/xchain-probe/';
const MANIFEST = fileURLToPath(new URL('./results/logs/manifest.json', import.meta.url));
const REQUIRED_LEGS = ['chrome-desktop', 'firefox-desktop', 'chrome-android-emulator'];
const PROBES = ['P1', 'P2', 'P10', 'P11'];
const RECORDED_LEG = { chromium: 'chrome-desktop', firefox: 'firefox-desktop' };

function loadManifest() {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

function recordedRuns() {
    const manifest = loadManifest();
    const runs = buildRuns(
        manifest,
        (logPath) => readFileSync(resolve(dirname(MANIFEST), logPath), 'utf8'),
    );
    return manifest.map((entry, index) => ({ entry, run: runs[index] }));
}

async function readEvents(page) {
    return parseProbeLog(await page.evaluate('JSON.stringify(events)'));
}

test('the manifest holds a run per probe on each of the three drivable legs', () => {
    const manifest = loadManifest();
    for (const leg of REQUIRED_LEGS) {
        for (const probe of PROBES) {
            const count = manifest.filter((e) => e.leg === leg && e.probe === probe).length;
            expect(count, `${leg} has no ${probe} run`).toBeGreaterThan(0);
        }
    }
});

test('P1 rerun on the live page matches the recorded return cells', async ({ context, page }, info) => {
    const recorded = recordedRuns().find(({ entry: e }) => (
        e.leg === RECORDED_LEG[info.project.name] && e.probe === 'P1'
    ));
    expect(recorded, `no recorded P1 run for ${info.project.name}`).toBeTruthy();
    const { entry, run } = recorded;
    const session = JSON.parse(readFileSync(
        resolve(dirname(MANIFEST), entry.originLog),
        'utf8',
    ))[0].session;

    await page.goto(`${LIVE_PAGE}?session=${session}`);
    await page.fill('#fragment-marker', entry.marker);
    await page.fill('#session', session);
    await page.click('#apply-session');
    const popupPromise = context.waitForEvent('page');
    await page.click('#href-new');
    const landing = await popupPromise;
    await landing.waitForLoadState('load');
    await landing.click('#broadcast');
    await landing.waitForTimeout(500);
    const landingEvents = await readEvents(landing);
    await landing.click('#close-window').catch((error) => {
        if (!landing.isClosed()) throw error;
    });
    await page.waitForTimeout(1200);

    const originEvents = await readEvents(page);
    const rerun = summarizeReturn({
        origin: originEvents,
        landing: landingEvents,
        marker: entry.marker,
    });

    expect(rerun.landed).toBe(true);
    expect(rerun.closed).toBe(run.closed);
    expect(rerun.referrer).toBe(run.referrer);
    expect(rerun.fragment).toBe(run.fragment);
});
