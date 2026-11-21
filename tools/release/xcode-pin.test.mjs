// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { checkXcodePin, parseXcodebuildVersion } from './xcode-pin.mjs';

const output = 'Xcode 27.2\nBuild version 27B52\n';
const pin = { version: '27.2', build: '27B52' };

test('accepts matching Xcode version and build pins', () => {
    assert.deepEqual(checkXcodePin(output, pin), {
        ok: true,
        found: { version: '27.2', build: '27B52' },
    });
});

test('rejects a build mismatch', () => {
    assert.deepEqual(checkXcodePin(output, { ...pin, build: '27B51' }), {
        ok: false,
        found: { version: '27.2', build: '27B52' },
    });
});

test('rejects a version mismatch', () => {
    assert.deepEqual(checkXcodePin(output, { ...pin, version: '27.1' }), {
        ok: false,
        found: { version: '27.2', build: '27B52' },
    });
});

test('returns null for unparseable xcodebuild output', () => {
    assert.equal(parseXcodebuildVersion('xcodebuild is unavailable\n'), null);
    assert.deepEqual(checkXcodePin('xcodebuild is unavailable\n', pin), {
        ok: false,
        found: null,
    });
});

test('toolchain.json pins Xcode 27.2 build 27B52', () => {
    const toolchain = JSON.parse(readFileSync(
        new URL('./toolchain.json', import.meta.url),
        'utf8',
    ));
    assert.deepEqual(
        { version: toolchain.xcode.version, build: toolchain.xcode.build },
        pin,
    );
});
