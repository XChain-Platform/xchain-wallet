// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME_102_UNSUPPORTED_API_GREP } from '../_chrome102-js-apis.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const result = spawnSync(
    'git',
    [
        'grep',
        '-n',
        '-E',
        CHROME_102_UNSUPPORTED_API_GREP,
        '--',
        'packages/*/src/**',
    ],
    { cwd: root, encoding: 'utf8' },
);

assert.equal(
    result.error,
    undefined,
    `Chrome 102 API audit could not run git grep: ${result.error?.message}`,
);
assert.ok(
    result.status === 0 || result.status === 1,
    `Chrome 102 API audit failed: ${result.stderr}`,
);
assert.equal(
    result.status,
    1,
    `packages source uses APIs unavailable in Chrome 102:\n${result.stdout}`,
);

console.log('OK: packages source uses no post-Chrome-102 JavaScript APIs');
