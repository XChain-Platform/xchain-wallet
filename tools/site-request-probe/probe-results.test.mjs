// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeReturn } from './probe-log.mjs';
import { PROBE_SECTIONS, renderProbeResults } from './probe-results.mjs';

function event(type, pageId, details = {}) {
    return { type, pageId, session: 'session-1', ...details };
}

function tableLines(markdown) {
    return markdown.split('\n').filter((line) => line.startsWith('| '));
}

function cellCount(line) {
    return line.split(/(?<!\\)\|/).length - 2;
}

test('defines the four probe sections and their columns in probe order', () => {
    assert.deepEqual(
        PROBE_SECTIONS.map(({ heading }) => heading),
        [
            '## P1 Browser return',
            '## P2 Phone launch',
            '## P10 Custom scheme',
            '## P11 Fragment redirect',
        ],
    );
    assert.deepEqual(
        PROBE_SECTIONS.map(({ columns }) => columns.length),
        [15, 10, 10, 11],
    );
});

test('renders a summarized P1 run with normalized result cells', () => {
    const landingUserAgent = 'Probe Browser/123';
    const summary = summarizeReturn({
        origin: [
            event('page-loaded', 'origin-1'),
            event('broadcast-received', 'origin-1', {
                message: event('page-ready', 'landing-1'),
            }),
        ],
        landing: [event('page-loaded', 'landing-1', {
            landingMode: true,
            hash: '#marker',
            referrer: 'https://source.example/request',
            openerPresent: true,
            userAgent: landingUserAgent,
        })],
        marker: 'marker',
    });
    const rendered = renderProbeResults([{
        probe: 'P1',
        os: 'Test OS',
        browser: 'Probe Browser 123',
        defaultBrowser: true,
        appInstalled: true,
        sourceOrigin: 'https://source.example',
        control: 'anchor',
        originalTab: 'visible',
        tabReuse: false,
        ...summary,
    }]);
    const row = tableLines(rendered)[2];

    assert.match(row, /\| yes \|/);
    assert.match(row, /\| intact \|/);
    assert.match(row, new RegExp(`\\| ${landingUserAgent} \\|`));
});

test('renders only a P11 section when only a P11 run is present', () => {
    const rendered = renderProbeResults([{
        probe: 'P11',
        case: 'HTTP redirect',
        arrived: true,
        fragment: 'intact',
    }]);

    assert.match(rendered, /^## P11 Fragment redirect\n/);
    assert.doesNotMatch(rendered, /^## P1 /m);
    assert.doesNotMatch(rendered, /^## P2 /m);
    assert.doesNotMatch(rendered, /^## P10 /m);
});

test('orders sections by probe with one blank line between them', () => {
    const rendered = renderProbeResults([
        { probe: 'P11', case: 'redirect' },
        { probe: 'P1', originalTab: 'visible' },
    ]);

    assert.ok(rendered.indexOf('## P1 Browser return') < rendered.indexOf('## P11 Fragment redirect'));
    assert.match(rendered, /\(empty\) \|\n\n## P11 Fragment redirect\n/);
    assert.doesNotMatch(rendered, /\n\n\n## P11 Fragment redirect/);
});

test('escapes pipes and normalizes false, zero, and missing cells', () => {
    const rendered = renderProbeResults([{
        probe: 'P1',
        referrer: 'https://source.example/a|b',
        broadcastToOrigin: false,
        tabReuse: 0,
        unknownKey: 'must-not-render',
    }]);
    const lines = tableLines(rendered);
    const [header, separator, row] = lines;

    assert.match(row, /https:\/\/source\.example\/a\\\|b/);
    assert.match(row, /\| no \|$/);
    assert.match(row, /\| 0 \|/);
    assert.match(row, /\| \(empty\) \|/);
    assert.doesNotMatch(rendered, /must-not-render/);
    assert.equal(cellCount(separator), cellCount(header));
    assert.ok(rendered.endsWith('\n'));
});

test('preserves input order for runs in the same probe', () => {
    const rendered = renderProbeResults([
        { probe: 'P2', outcome: 'first' },
        { probe: 'P2', outcome: 'second' },
    ]);

    assert.ok(rendered.indexOf('first') < rendered.indexOf('second'));
});

test('returns an empty string for an empty run array', () => {
    assert.equal(renderProbeResults([]), '');
});

test('rejects unknown probes, invalid runs, and non-array input', () => {
    assert.throws(
        () => renderProbeResults([{ probe: 'P5' }]),
        (error) => error instanceof TypeError && error.message.includes('P5'),
    );
    assert.throws(() => renderProbeResults([null]), TypeError);
    assert.throws(() => renderProbeResults({}), TypeError);
});
