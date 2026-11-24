// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import {
    buildMeasuredWidths,
    checkMeasuredWidths,
    parseFoldLines,
} from '../../../packages/mobile/scripts/duo-fixture.js';

const SCRIPT = resolve(process.cwd(), 'packages/mobile/scripts/duo-fixture.js');
const MEASURED_AT = '2026-11-22T18:22:31.123Z';
const DEVICE = 'XC iPhone Duo';
const earlierOpenPortraitFold = {
    display: 'inner',
    division: {
        height: 669,
        orientation: 'vertical',
        width: 12,
        x: 469.5,
        y: 0,
    },
    posture: 'open',
    viewport: {
        height: 669,
        width: 951,
    },
};
const settledOpenPortraitFold = {
    display: 'inner',
    division: {
        height: 669,
        orientation: 'vertical',
        width: 0,
        x: 475.5,
        y: 0,
    },
    posture: 'open',
    viewport: {
        height: 669,
        width: 951,
    },
};
const closedPortraitFold = {
    display: 'outer',
    division: {
        height: 0,
        orientation: 'none',
        width: 0,
        x: 0,
        y: 0,
    },
    posture: 'closed',
    viewport: {
        height: 669,
        width: 475,
    },
};
const unreachableArguments = [
    '--unreachable',
    'closed-landscape=simulator cannot rotate the outer display',
    '--unreachable',
    'open-landscape=simulator posture is unavailable',
    '--unreachable',
    'partial-vertical=simulator posture is unavailable',
    '--unreachable',
    'partial-horizontal=simulator posture is unavailable',
];

let scratch;

function run(args) {
    try {
        return {
            status: 0,
            stdout: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' }),
            stderr: '',
        };
    } catch (error) {
        return {
            status: error.status,
            stdout: error.stdout,
            stderr: error.stderr,
        };
    }
}

function writeLog(name, lines) {
    const path = resolve(scratch, name);
    writeFileSync(path, `${lines.join('\n')}\n`);
    return path;
}

function validLogs() {
    const openLog = writeLog('open=portrait.log', [
        `2026-11-22 Demo[1:2] fold: ${JSON.stringify(earlierOpenPortraitFold)}`,
        `2026-11-22 Demo[1:2] fold: ${JSON.stringify(settledOpenPortraitFold)}`,
    ]);
    const closedLog = writeLog('closed-portrait.log', [
        `2026-11-22 Demo[1:2] fold: ${JSON.stringify(closedPortraitFold)}`,
    ]);
    return { closedLog, openLog };
}

beforeEach(() => {
    const tmp = resolve(process.cwd(), 'tmp');
    mkdirSync(tmp, { recursive: true });
    scratch = mkdtempSync(resolve(tmp, 'duo-fixture-cli-'));
});

afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
});

describe('Duo fixture CLI', () => {
    it('writes the settled readings and unreachable states as a checked fixture', () => {
        const { closedLog, openLog } = validLogs();
        const out = resolve(scratch, 'nested', 'measured-widths.json');
        const result = run([
            'write',
            '--device',
            DEVICE,
            '--out',
            out,
            '--measured-at',
            MEASURED_AT,
            '--state',
            `open-portrait=${openLog}`,
            '--state',
            `closed-portrait=${closedLog}`,
            ...unreachableArguments,
        ]);

        const openReadings = parseFoldLines(readFileSync(openLog, 'utf8'));
        const closedReadings = parseFoldLines(readFileSync(closedLog, 'utf8'));
        const expected = buildMeasuredWidths({
            device: DEVICE,
            measuredAt: MEASURED_AT,
            folds: {
                'closed-portrait': closedReadings,
                'open-portrait': openReadings,
            },
            unreachable: {
                'closed-landscape': 'simulator cannot rotate the outer display',
                'open-landscape': 'simulator posture is unavailable',
                'partial-vertical': 'simulator posture is unavailable',
                'partial-horizontal': 'simulator posture is unavailable',
            },
        });
        const written = readFileSync(out, 'utf8');

        expect(result).toEqual({ status: 0, stdout: '', stderr: '' });
        expect(JSON.parse(written)).toEqual(expected);
        expect(checkMeasuredWidths(JSON.parse(written))).toEqual([]);
        expect(written).toBe(`${JSON.stringify(expected, null, 4)}\n`);
    });

    it('exits 1 naming a state whose log has no fold reading and writes no file', () => {
        const { openLog } = validLogs();
        const emptyLog = writeLog('empty.log', ['unrelated simulator output']);
        const out = resolve(scratch, 'measured-widths.json');
        const result = run([
            'write', '--device', DEVICE, '--out', out,
            '--state', `closed-portrait=${emptyLog}`,
            '--state', `open-portrait=${openLog}`,
            ...unreachableArguments,
        ]);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('closed-portrait');
        expect(existsSync(out)).toBe(false);
    });

    it('exits 1 for an unknown state name and writes no file', () => {
        const unknownLog = writeLog('unknown.log', [
            `prefix fold: ${JSON.stringify(closedPortraitFold)}`,
        ]);
        const out = resolve(scratch, 'measured-widths.json');
        const result = run([
            'write', '--device', DEVICE, '--out', out,
            '--state', `tent-mode=${unknownLog}`,
        ]);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('tent-mode');
        expect(existsSync(out)).toBe(false);
    });

    it('exits 1 naming a log path it cannot read and writes no file', () => {
        const missingLog = resolve(scratch, 'missing.log');
        const out = resolve(scratch, 'measured-widths.json');
        const result = run([
            'write', '--device', DEVICE, '--out', out,
            '--state', `closed-portrait=${missingLog}`,
        ]);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(missingLog);
        expect(existsSync(out)).toBe(false);
    });

    it('exits 1 when a state is assigned twice and writes no file', () => {
        const { closedLog } = validLogs();
        const out = resolve(scratch, 'measured-widths.json');
        const result = run([
            'write', '--device', DEVICE, '--out', out,
            '--state', `closed-portrait=${closedLog}`,
            '--unreachable', 'closed-portrait=simulator cannot reach it',
        ]);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('closed-portrait');
        expect(existsSync(out)).toBe(false);
    });

    it('exits 2 when --out is missing', () => {
        const result = run(['write', '--device', DEVICE]);

        expect(result).toEqual({ status: 2, stdout: '', stderr: '' });
    });

    it.each([
        ['an unknown verb', ['unknown']],
        [
            'an unknown flag',
            ['write', '--device', DEVICE, '--out', 'unused.json', '--unknown', 'value'],
        ],
        ['a flag with no value', ['write', '--device', DEVICE, '--out']],
        [
            'a --state value with no equals sign',
            ['write', '--device', DEVICE, '--out', 'unused.json', '--state', 'closed-portrait'],
        ],
        [
            'an --unreachable value with no equals sign',
            [
                'write', '--device', DEVICE, '--out', 'unused.json',
                '--unreachable', 'closed-portrait',
            ],
        ],
        ['a missing --device', ['write', '--out', 'unused.json']],
    ])('exits 2 for %s', (_description, args) => {
        expect(run(args)).toEqual({ status: 2, stdout: '', stderr: '' });
    });

    it('reports every fixture check problem and writes no file', () => {
        const out = resolve(scratch, 'measured-widths.json');
        const allUnreachable = [
            ...unreachableArguments,
            '--unreachable',
            'closed-portrait=simulator posture is unavailable',
            '--unreachable',
            'open-portrait=simulator posture is unavailable',
        ];
        const result = run([
            'write', '--device', '', '--out', out,
            '--measured-at', 'not-a-timestamp',
            ...allUnreachable,
        ]);

        expect(result.status).toBe(1);
        expect(result.stderr.trim().split('\n')).toEqual([
            'device must be a non-empty string',
            'measuredAt must be an ISO 8601 timestamp',
        ]);
        expect(existsSync(out)).toBe(false);
    });

    it('uses a current ISO timestamp when --measured-at is omitted', () => {
        const out = resolve(scratch, 'measured-widths.json');
        const before = Date.now();
        const result = run([
            'write', '--device', DEVICE, '--out', out,
            ...unreachableArguments,
            '--unreachable',
            'closed-portrait=simulator posture is unavailable',
            '--unreachable',
            'open-portrait=simulator posture is unavailable',
        ]);
        const after = Date.now();
        const fixture = JSON.parse(readFileSync(out, 'utf8'));

        expect(result).toEqual({ status: 0, stdout: '', stderr: '' });
        expect(Date.parse(fixture.measuredAt)).toBeGreaterThanOrEqual(before);
        expect(Date.parse(fixture.measuredAt)).toBeLessThanOrEqual(after);
        expect(checkMeasuredWidths(fixture)).toEqual([]);
    });
});
