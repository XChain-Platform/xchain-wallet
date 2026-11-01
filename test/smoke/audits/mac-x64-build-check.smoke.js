// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const workflow = readFileSync(join(root, '.github/workflows/mac-x64-swap-check.yml'), 'utf8');
const executable = workflow.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

assert.match(workflow, /name: macOS x64 native build check/);
assert.match(workflow, /runs-on:\s*macos-15-intel/);
assert.match(workflow, /pointerMatches/);
assert.match(workflow, /x64Only/);
assert.doesNotMatch(executable, /automated-swap-check/,
    'a build and pointer inspection must not emit swap evidence');
assert.doesNotMatch(executable, /swap-check-result\.json|upload-artifact/,
    'the CI-only gate must not publish a rehearsal evidence file');
assert.doesNotMatch(executable, /Number\(c\)\s*\+\s*1|Bump the desktop package/,
    'the build gate inspects the tagged build once');

console.log('mac-x64-build-check.smoke.js: ok');
