// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    findRawTokenColorViolations,
    readSharedCssSources,
} from '../../helpers/sharedCssColorTokens.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const tokens = readFileSync(join(root, 'packages/core/src/ui/tokens.css'), 'utf8');
const files = readSharedCssSources(root);
const violations = findRawTokenColorViolations(tokens, files);

assert.ok(files.length > 0, 'shared CSS modules are present');
assert.deepEqual(violations, [], `raw colors duplicate theme tokens:\n${violations
    .map(({ path, line, color }) => `${path}:${line}: ${color}`)
    .join('\n')}`);

console.log(`OK: ${files.length} shared CSS modules avoid raw theme-token colors`);
