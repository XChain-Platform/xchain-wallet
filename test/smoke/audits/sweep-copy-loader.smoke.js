// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const home = readFileSync(join(repoRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Home.jsx'), 'utf8');

assert.match(
    home,
    /<h1 className="sr-only">Home<\/h1>/,
    'source-reading smokes see the English copy rendered by Home',
);

console.log('sweep copy loader smoke OK');
