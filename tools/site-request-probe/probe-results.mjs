// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { matrixRow } from './probe-log.mjs';

const RUN_COLUMNS = [
    ['OS', 'os'],
    ['Browser and version', 'browser'],
    ['Default browser', 'defaultBrowser'],
    ['App installed', 'appInstalled'],
    ['Source origin', 'sourceOrigin'],
    ['Control', 'control'],
];

export const PROBE_SECTIONS = [
    {
        probe: 'P1',
        heading: '## P1 Browser return',
        columns: [
            ...RUN_COLUMNS,
            ['Original tab', 'originalTab'],
            ['Landed', 'landed'],
            ['Landing browser', 'landingUserAgent'],
            ['Tab reuse', 'tabReuse'],
            ['Opener', 'openerPresent'],
            ['window.close()', 'closed'],
            ['Referrer', 'referrer'],
            ['Fragment', 'fragment'],
            ['Broadcast to origin', 'broadcastToOrigin'],
        ],
    },
    {
        probe: 'P2',
        heading: '## P2 Phone launch',
        columns: [
            ...RUN_COLUMNS,
            ['Gesture active', 'userActivationActive'],
            ['Popup blocked', 'popupBlocked'],
            ['Lost focus', 'lostFocus'],
            ['Outcome', 'outcome'],
        ],
    },
    {
        probe: 'P10',
        heading: '## P10 Custom scheme',
        columns: [
            ...RUN_COLUMNS,
            ['Gesture active', 'userActivationActive'],
            ['Popup blocked', 'popupBlocked'],
            ['Lost focus', 'lostFocus'],
            ['Outcome', 'outcome'],
        ],
    },
    {
        probe: 'P11',
        heading: '## P11 Fragment redirect',
        columns: [
            ...RUN_COLUMNS,
            ['Case', 'case'],
            ['Arrived', 'arrived'],
            ['Fragment', 'fragment'],
            ['Navigation type', 'navigationType'],
            ['Final address', 'finalAddress'],
        ],
    },
];

const PROBES = new Set(PROBE_SECTIONS.map(({ probe }) => probe));

function validateRuns(runs) {
    if (!Array.isArray(runs)) {
        throw new TypeError('Probe runs must be an array');
    }

    for (const run of runs) {
        if (run === null || typeof run !== 'object' || Array.isArray(run)
            || !PROBES.has(run.probe)) {
            throw new TypeError(`Invalid probe: ${String(run?.probe)}`);
        }
    }
}

function cellValue(value) {
    if (value === undefined || value === null) return null;
    if (value === true) return 'yes';
    if (value === false) return 'no';
    return value;
}

export function renderProbeResults(runs) {
    validateRuns(runs);

    const sections = [];
    for (const { probe, heading, columns } of PROBE_SECTIONS) {
        const probeRuns = runs.filter((run) => run.probe === probe);
        if (probeRuns.length === 0) continue;

        const headers = columns.map(([header]) => header);
        const lines = [
            heading,
            '',
            matrixRow(headers),
            matrixRow(headers.map(() => '---')),
            ...probeRuns.map((run) => matrixRow(
                columns.map(([, key]) => cellValue(run[key])),
            )),
        ];
        sections.push(lines.join('\n'));
    }

    return sections.length === 0 ? '' : `${sections.join('\n\n')}\n`;
}
