// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readPendingWatchKeys } from './pending-watch-keys.mjs';

const watchDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(watchDirectory, '../..');
const scriptPath = join(watchDirectory, 'pending-watch-keys.mjs');

test('returns an empty list when pendingWatchKeys is absent', () => {
    const source = `
        const mention = 'pendingWatchKeys = { fake: "row" }';
        // const pendingWatchKeys = { fake: 'row' };
    `;
    assert.deepEqual(readPendingWatchKeys(source), []);
});

test('returns an empty list for an empty object', () => {
    assert.deepEqual(readPendingWatchKeys('const pendingWatchKeys = {};'), []);
});

test('returns an empty list for an empty Map', () => {
    assert.deepEqual(readPendingWatchKeys('const pendingWatchKeys = new Map([]);'), []);
});

test('reads object keys in source order with comments and a trailing comma', () => {
    const source = `
        const pendingWatchKeys = {
            // first
            firstKey: 'row one',
            /* second */
            "second-key": "row two",
        };
    `;

    assert.deepEqual(readPendingWatchKeys(source), [
        { key: 'firstKey', row: 'row one' },
        { key: 'second-key', row: 'row two' },
    ]);
});

test('reads Map keys in source order with comments and a trailing comma', () => {
    const source = `
        const pendingWatchKeys = new Map([
            // first
            ['firstKey', 'row one'],
            /* second */
            ["second-key", "row two"],
        ]);
    `;

    assert.deepEqual(readPendingWatchKeys(source), [
        { key: 'firstKey', row: 'row one' },
        { key: 'second-key', row: 'row two' },
    ]);
});

test('reads a dotted quoted key', () => {
    const source = "const pendingWatchKeys = { 'wallet.balance.title': 'row 9' };";
    assert.deepEqual(readPendingWatchKeys(source), [
        { key: 'wallet.balance.title', row: 'row 9' },
    ]);
});

test('CLI reports fresh pending keys and succeeds for a fresh empty file', (context) => {
    const temporaryRoot = join(repositoryRoot, 'tmp');
    mkdirSync(temporaryRoot, { recursive: true });
    const fixtureDirectory = mkdtempSync(join(temporaryRoot, 'pending-watch-keys-'));
    context.after(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

    const pendingPath = join(fixtureDirectory, 'pending.mjs');
    const emptyPath = join(fixtureDirectory, 'empty.mjs');
    writeFileSync(pendingPath, `
        const pendingWatchKeys = new Map([
            ['cli.first', 'row A'],
            ['cli.second', 'row B'],
        ]);
    `);
    writeFileSync(emptyPath, 'const pendingWatchKeys = {};\n');

    assert.throws(
        () => execFileSync(process.execPath, [scriptPath, pendingPath], { encoding: 'utf8' }),
        (error) => {
            assert.equal(error.status, 1);
            assert.equal(error.stdout, 'cli.first row A\ncli.second row B\n');
            return true;
        },
    );
    assert.equal(
        execFileSync(process.execPath, [scriptPath, emptyPath], { encoding: 'utf8' }),
        '',
    );
});
