// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    findLogEntry,
    parseLogNdjson,
} from '../../../packages/mobile/scripts/sim-log.js';

const SCRIPT = resolve(process.cwd(), 'packages/mobile/scripts/sim-log.js');
const LOG = `{"eventType":"logEvent","eventMessage":"Received snapshot W1","subsystem":"io.xchain.wallet.watch","category":"snapshot","processImagePath":"/Applications/XChain Watch.app/XChain Watch","processID":417,"timestamp":"2026-11-21 10:15:30.100-0800"}
{"eventType":"activityCreateEvent","eventMessage":"Not a log message","subsystem":"io.xchain.wallet.watch","category":"snapshot","processImagePath":"/Applications/XChain Watch.app/XChain Watch","processID":417,"timestamp":"2026-11-21 10:15:30.200-0800"}
plain-text diagnostic

{"eventType":"logEvent","eventMessage":"Rendered W1 balance","subsystem":"io.xchain.wallet","category":"render","processImagePath":"/Applications/XChain.app/XChain","processID":812,"timestamp":"2026-11-21 10:15:30.300-0800"}
{"count":3,"finished":1}
`;
const entries = parseLogNdjson(LOG);

describe('simulator log readers', () => {
    it('parses log events in order and skips other NDJSON input', () => {
        expect(entries).toEqual([
            {
                timestamp: '2026-11-21 10:15:30.100-0800',
                processID: 417,
                process: 'XChain Watch',
                subsystem: 'io.xchain.wallet.watch',
                category: 'snapshot',
                message: 'Received snapshot W1',
            },
            {
                timestamp: '2026-11-21 10:15:30.300-0800',
                processID: 812,
                process: 'XChain',
                subsystem: 'io.xchain.wallet',
                category: 'render',
                message: 'Rendered W1 balance',
            },
        ]);
    });

    it('finds the first entry matching every supplied field', () => {
        expect(findLogEntry(entries, {
            process: 'XChain Watch',
            subsystem: 'io.xchain.wallet.watch',
            category: 'snapshot',
            messageContains: 'snapshot W1',
        })).toBe(entries[0]);
        expect(findLogEntry(entries, {
            process: 'XChain',
            messageContains: 'snapshot',
        })).toBe(null);
        expect(findLogEntry(entries, { messageContains: 'missing' })).toBe(null);
    });
});

describe('simulator log CLI', () => {
    it('exits 0 when every requested field matches', () => {
        expect(execFileSync(process.execPath, [
            SCRIPT,
            'find',
            '--contains',
            'snapshot W1',
            '--process',
            'XChain Watch',
            '--subsystem',
            'io.xchain.wallet.watch',
            '--category',
            'snapshot',
        ], {
            encoding: 'utf8',
            input: LOG,
        })).toBe('');
    });

    it('names the wanted text and exits 1 when no entry matches', () => {
        let failure;
        try {
            execFileSync(process.execPath, [SCRIPT, 'find', '--contains', 'Not logged'], {
                encoding: 'utf8',
                input: LOG,
            });
        } catch (error) {
            failure = error;
        }

        expect(failure?.status).toBe(1);
        expect(failure?.stdout).toBe('Log entry not found: Not logged\n');
    });

    it.each([
        ['missing --contains', ['find', '--process', 'XChain']],
        ['an unknown flag', ['find', '--contains', 'W1', '--unknown', 'value']],
        ['a flag without a value', ['find', '--contains', 'W1', '--category']],
    ])('exits 2 for %s', (_description, args) => {
        let failure;
        try {
            execFileSync(process.execPath, [SCRIPT, ...args], {
                encoding: 'utf8',
                input: LOG,
            });
        } catch (error) {
            failure = error;
        }

        expect(failure?.status).toBe(2);
        expect(failure?.stdout).toBe('');
    });
});
