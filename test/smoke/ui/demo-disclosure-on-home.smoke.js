// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Demo disclosure appears on demand at the blocked Send action, while
// shell-level expiry enforcement remains renderless.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

const homeSrc = read('packages', 'core', 'src', 'shared', 'routes', 'Home.jsx');
const webSrc = read('packages', 'web', 'src', 'App.jsx');
const popupSrc = read('packages', 'extension', 'src', 'popup', 'App.jsx');
const autoWipeSrc = read('packages', 'core', 'src', 'shared', 'hooks', 'useDemoAutoWipe.js');

for (const [label, src] of [['Home', homeSrc], ['web', webSrc], ['extension', popupSrc]]) {
    assert.doesNotMatch(src, /<DemoBanner\b/, `${label} does not render DemoBanner`);
    assert.doesNotMatch(src, /components\/DemoBanner\.jsx/, `${label} does not import DemoBanner`);
}

assert.match(
    homeSrc,
    /Demo wallets cannot send\. Create a real wallet to send\./,
    'Home carries the short blocked-send note',
);
assert.match(homeSrc, /Exit demo & wipe/, 'the blocked-send note carries the exit action');

for (const [label, src] of [['web', webSrc], ['extension', popupSrc]]) {
    assert.match(src, /useDemoAutoWipe\(activeWalletId, refresh\)/, `${label} enforces demo expiry`);
}
assert.match(autoWipeSrc, /setInterval\(tick, 60_000\)/, 'demo expiry checks every minute');

console.log('demo-disclosure-on-home smoke OK');
