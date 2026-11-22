// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkFixtureFile } from '../../helpers/watchFixtureFile.js';

const scratchRoot = resolve(process.cwd(), 'tmp');
const originalWriteSetting = process.env.WATCH_FIXTURES_WRITE;
let scratchDirectory;

beforeEach(() => {
    mkdirSync(scratchRoot, { recursive: true });
    scratchDirectory = mkdtempSync(join(scratchRoot, 'watch-fixture-file-'));
    delete process.env.WATCH_FIXTURES_WRITE;
});

afterEach(() => {
    rmSync(scratchDirectory, { recursive: true, force: true });
    if (originalWriteSetting === undefined) {
        delete process.env.WATCH_FIXTURES_WRITE;
    } else {
        process.env.WATCH_FIXTURES_WRITE = originalWriteSetting;
    }
});

describe('watch fixture file', () => {
    it('reports missing and differing fixtures without writing', () => {
        const path = join(scratchDirectory, 'fixture.json');

        expect(checkFixtureFile(path, { value: 1 })).toEqual({ status: 'missing' });
        expect(existsSync(path)).toBe(false);

        writeFileSync(path, '{"value":2}\n');
        expect(checkFixtureFile(path, { value: 1 })).toEqual({ status: 'differs' });
        expect(readFileSync(path, 'utf8')).toBe('{"value":2}\n');
    });

    it('creates parent directories with exact four-space JSON bytes', () => {
        const path = join(scratchDirectory, 'nested', 'fixture.json');
        const value = { first: 1, nested: { enabled: true } };
        const expected = [
            '{',
            '    "first": 1,',
            '    "nested": {',
            '        "enabled": true',
            '    }',
            '}',
            '',
        ].join('\n');

        expect(checkFixtureFile(path, value, { write: true })).toEqual({ status: 'created' });
        expect(readFileSync(path, 'utf8')).toBe(expected);
        expect(checkFixtureFile(path, value, { write: true })).toEqual({ status: 'same' });
    });

    it('reformats equal JSON even when its object keys are reordered', () => {
        const path = join(scratchDirectory, 'fixture.json');
        const value = { first: 1, second: 2 };
        writeFileSync(path, '{"second":2,"first":1}');

        expect(checkFixtureFile(path, value, { write: true })).toEqual({
            status: 'reformatted',
        });
        expect(readFileSync(path, 'utf8')).toBe(`${JSON.stringify(value, null, 4)}\n`);
    });

    it('refuses valid and invalid content changes unless they are allowed', () => {
        const validPath = join(scratchDirectory, 'valid.json');
        const invalidPath = join(scratchDirectory, 'invalid.json');
        writeFileSync(validPath, '{"value":2}\n');
        writeFileSync(invalidPath, 'not json');

        expect(checkFixtureFile(validPath, { value: 1 }, { write: true })).toEqual({
            status: 'contentChanged',
        });
        expect(checkFixtureFile(invalidPath, { value: 1 }, { write: true })).toEqual({
            status: 'contentChanged',
        });
        expect(readFileSync(validPath, 'utf8')).toBe('{"value":2}\n');
        expect(readFileSync(invalidPath, 'utf8')).toBe('not json');
    });

    it('rewrites changed content only when explicitly allowed', () => {
        const path = join(scratchDirectory, 'fixture.json');
        const value = { value: 1 };
        writeFileSync(path, '{"value":2}\n');

        expect(checkFixtureFile(path, value, {
            write: true,
            allowContentChange: true,
        })).toEqual({ status: 'rewritten' });
        expect(readFileSync(path, 'utf8')).toBe(`${JSON.stringify(value, null, 4)}\n`);
    });

    it('reads the environment write default at call time', () => {
        const path = join(scratchDirectory, 'fixture.json');

        expect(checkFixtureFile(path, { value: 1 })).toEqual({ status: 'missing' });
        process.env.WATCH_FIXTURES_WRITE = '1';
        expect(checkFixtureFile(path, { value: 1 })).toEqual({ status: 'created' });
    });
});
