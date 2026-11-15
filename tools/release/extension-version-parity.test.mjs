// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { deriveExtensionVersion } from '../../packages/core/scripts/derive-extension-version.js';

const SIGN = fileURLToPath(new URL('./sign.sh', import.meta.url));

function bashDeriver() {
    const source = readFileSync(SIGN, 'utf8');
    const match = /^derive_extension_version\(\) \{\n([\s\S]*?)^\}$/m.exec(source);
    assert.ok(match, 'sign.sh must expose derive_extension_version as one shell function');
    return `derive_extension_version() {\n${match[1]}}`;
}

const CASES = [
    '0.341.4',
    '0.342.0-beta.1',
    '12.34.56-rc.789',
    '0.341.4-respin.1',
    '65535.65535.65535',
    '1.2.3-beta.65535',
    '1.2.3-respin.0',
    '1.2.3-preview.1',
    '1.2.3+build.7',
    '65536.0.0',
    '1.2.00003',
    '1.2.000003',
    '1.2.3-beta.000001',
    '1.2.3-respin.000001',
    '',
];

test('the six-digit zero-padded spelling is refused by both implementations', () => {
    const shell = spawnSync('bash', ['-c', `${bashDeriver()}\nderive_extension_version "$1"`, '_', '1.2.000003'],
        { encoding: 'utf8' });
    assert.notEqual(shell.status, 0);
    assert.throws(() => deriveExtensionVersion('1.2.000003'));
});

test('the signing gate and the shared JS rule agree over one table', () => {
    const shellFunction = bashDeriver();
    for (const input of CASES) {
        const shell = spawnSync('bash', ['-c', `${shellFunction}\nderive_extension_version "$1"`, '_', input],
            { encoding: 'utf8' });
        let js = null;
        let jsRejected = false;
        try {
            js = deriveExtensionVersion(input);
        } catch {
            jsRejected = true;
        }
        assert.equal(shell.status !== 0, jsRejected, `${input || '(empty)'} rejection parity`);
        if (!jsRejected) assert.equal(shell.stdout, js, `${input} output parity`);
    }
});
