// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildRuns } from './probe-report.mjs';

const REPORTER = fileURLToPath(new URL('./probe-report.mjs', import.meta.url));

function event(type, pageId, details = {}) {
    return { type, pageId, session: 'session-1', ...details };
}

function fixture(t) {
    const directory = mkdtempSync(join(tmpdir(), 'probe-report-test-'));
    t.after(() => rmSync(directory, { force: true, recursive: true }));
    return directory;
}

function writeJson(path, value) {
    writeFileSync(path, JSON.stringify(value));
}

function runReporter(args) {
    return spawnSync(process.execPath, [REPORTER, ...args], { encoding: 'utf8' });
}

test('renders a P1 landing log and lets its cells override manifest values', (t) => {
    const directory = fixture(t);
    const origin = [event('page-loaded', 'origin-1')];
    const landing = [event('page-loaded', 'landing-1', {
        landingMode: true,
        hash: '#return-marker',
        referrer: 'https://source.example/request',
        openerPresent: false,
        userAgent: 'Probe Browser/123',
    })];
    writeJson(join(directory, 'origin.json'), origin);
    writeJson(join(directory, 'landing.json'), landing);
    writeJson(join(directory, 'manifest.json'), [{
        probe: 'P1',
        browser: 'Probe Browser 123',
        landed: false,
        originLog: 'origin.json',
        landingLog: 'landing.json',
        marker: 'return-marker',
    }]);

    const result = runReporter([join(directory, 'manifest.json')]);

    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /^## P1 Browser return\n/);
    assert.match(result.stdout, /\| yes \| Probe Browser\/123 \|/);
    assert.match(result.stdout, /\| intact \|/);
});

test('renders a P1 landing received through the origin broadcast fallback', (t) => {
    const directory = fixture(t);
    writeJson(join(directory, 'origin.json'), [
        event('page-loaded', 'origin-1'),
        event('broadcast-received', 'origin-1', {
            message: event('page-ready', 'landing-1', {
                href: 'https://probe.example/?landing=1#return-marker',
                hash: '#return-marker',
                userAgent: 'Fallback Browser',
            }),
        }),
    ]);
    writeJson(join(directory, 'manifest.json'), [{
        probe: 'P1',
        originLog: 'origin.json',
        landingLog: null,
        marker: 'return-marker',
    }]);

    const result = runReporter([join(directory, 'manifest.json')]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /\| yes \| Fallback Browser \|/);
    assert.match(result.stdout, /\| intact \|/);
});

test('selects one P2 launch and removes manifest-only keys', () => {
    const entries = [
        event('launch-attempt', 'source-1', {
            launchType: 'location.assign',
            target: 'https://destination.example',
            userActivationActive: true,
        }),
        event('pagehide', 'source-1'),
        event('anchor-launch', 'source-1', {
            control: 'phone-anchor',
            target: 'tel:+15555550123',
            userActivationActive: true,
        }),
    ];
    const [run] = buildRuns([{
        probe: 'P2',
        control: 'script',
        log: 'launches.json',
        launch: 'location.assign',
        lostFocus: false,
    }], (path) => {
        assert.equal(path, 'launches.json');
        return JSON.stringify(entries);
    });

    assert.deepEqual(run, {
        probe: 'P2',
        control: 'script',
        lostFocus: true,
        kind: 'script',
        target: 'https://destination.example',
        userActivationActive: true,
        popupBlocked: null,
    });
});

test('renders only the P11 section for a lone redirect run', (t) => {
    const directory = fixture(t);
    writeJson(join(directory, 'destination.json'), [event('page-loaded', 'destination-1', {
        hash: '#redirect-marker',
        navigationType: 'navigate',
    })]);
    writeJson(join(directory, 'manifest.json'), [{
        probe: 'P11',
        case: 'HTTP redirect',
        finalAddress: 'https://destination.example/#redirect-marker',
        destinationLog: 'destination.json',
        marker: 'redirect-marker',
    }]);

    const result = runReporter([join(directory, 'manifest.json')]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /^## P11 Fragment redirect\n/);
    assert.doesNotMatch(result.stdout, /^## P1 /m);
    assert.doesNotMatch(result.stdout, /^## P2 /m);
    assert.doesNotMatch(result.stdout, /^## P10 /m);
    assert.match(result.stdout, /\| yes \| intact \| navigate \|/);
});

test('--out writes exactly the stdout report and prints nothing', (t) => {
    const directory = fixture(t);
    const manifestPath = join(directory, 'manifest.json');
    const outputPath = join(directory, 'report.md');
    writeJson(join(directory, 'launches.json'), [event('launch-attempt', 'source-1', {
        launchType: 'location.assign',
        target: 'https://destination.example',
    })]);
    writeJson(manifestPath, [{
        probe: 'P2',
        log: 'launches.json',
        launch: 'location.assign',
    }]);

    const stdoutRun = runReporter([manifestPath]);
    const outputRun = runReporter([manifestPath, '--out', outputPath]);

    assert.equal(stdoutRun.status, 0);
    assert.equal(outputRun.status, 0);
    assert.equal(outputRun.stdout, '');
    assert.equal(outputRun.stderr, '');
    assert.equal(readFileSync(outputPath, 'utf8'), stdoutRun.stdout);
});

test('reports invalid logs, probes, and launch selectors without writing output', (t) => {
    const directory = fixture(t);
    const manifestPath = join(directory, 'manifest.json');
    const outputPath = join(directory, 'report.md');
    const invalidLogPath = join(directory, 'invalid.json');
    writeJson(invalidLogPath, { type: 'page-loaded' });
    writeJson(manifestPath, [{
        probe: 'P2',
        log: 'invalid.json',
        launch: 'location.assign',
    }]);

    const invalidLog = runReporter([manifestPath, '--out', outputPath]);
    assert.equal(invalidLog.status, 1);
    assert.match(invalidLog.stderr, /invalid\.json/);
    assert.equal(existsSync(outputPath), false);

    writeJson(manifestPath, [{ probe: 'P5' }]);
    const unknownProbe = runReporter([manifestPath]);
    assert.equal(unknownProbe.status, 1);
    assert.match(unknownProbe.stderr, /P5/);

    writeJson(join(directory, 'launches.json'), [event('anchor-launch', 'source-1', {
        control: 'phone-anchor',
    })]);
    writeJson(manifestPath, [{
        probe: 'P2',
        log: 'launches.json',
        launch: 'location.assign',
    }]);
    const unmatchedLaunch = runReporter([manifestPath]);
    assert.equal(unmatchedLaunch.status, 1);
    assert.match(unmatchedLaunch.stderr, /location\.assign/);
});

test('rejects missing log keys with the manifest entry index', () => {
    assert.throws(
        () => buildRuns([{
            probe: 'P11',
            marker: 'marker',
        }], () => '[]'),
        /entry 0.*destinationLog/i,
    );
});

test('exits 2 with usage for missing arguments, flags, and missing --out values', () => {
    for (const args of [
        [],
        ['manifest.json', '--out'],
        ['manifest.json', '--unknown'],
        ['manifest.json', '--out', '--unknown'],
    ]) {
        const result = runReporter(args);
        assert.equal(result.status, 2);
        assert.match(result.stderr, /^Usage: node tools\/site-request-probe\/probe-report\.mjs /);
        assert.equal(result.stdout, '');
    }
});

test('exits 1 for unreadable and non-array manifests without writing output', (t) => {
    const directory = fixture(t);
    const missingPath = join(directory, 'missing.json');
    const manifestPath = join(directory, 'manifest.json');
    const outputPath = join(directory, 'report.md');

    const unreadable = runReporter([missingPath, '--out', outputPath]);
    assert.equal(unreadable.status, 1);
    assert.match(unreadable.stderr, /missing\.json/);
    assert.equal(existsSync(outputPath), false);

    writeJson(manifestPath, {});
    const nonArray = runReporter([manifestPath, '--out', outputPath]);
    assert.equal(nonArray.status, 1);
    assert.match(nonArray.stderr, /JSON array/);
    assert.equal(existsSync(outputPath), false);
});
