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
import { englishDictionarySource } from '../../helpers/englishNamespaces.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

const homeSrc = read('packages', 'core', 'src', 'shared', 'routes', 'Home.jsx');
const webSrc = read('packages', 'web', 'src', 'App.jsx');
const popupSrc = read('packages', 'extension', 'src', 'popup', 'App.jsx');
const enLocaleSrc = englishDictionarySource();
const autoWipeSrc = read('packages', 'core', 'src', 'shared', 'hooks', 'useDemoAutoWipe.js');

for (const [label, src] of [['Home', homeSrc], ['web', webSrc], ['extension', popupSrc]]) {
    assert.doesNotMatch(src, /<DemoBanner\b/, `${label} does not render DemoBanner`);
    assert.doesNotMatch(src, /components\/DemoBanner\.jsx/, `${label} does not import DemoBanner`);
}

// Home has no Send button, so it carries no blocked-send note; Send itself says why a demo wallet cannot send.
assert.doesNotMatch(homeSrc, /home\.demoSendBlocked/, 'Home carries no blocked-send note');
assert.doesNotMatch(enLocaleSrc, /'home\.demoSendBlocked'/, 'the blocked-send note key is gone');
assert.match(enLocaleSrc, /'walletDetails\.exitDemoAction': 'Exit Demo & Wipe'/, 'the exit action is named for what it does');

for (const [label, src] of [['web', webSrc], ['extension', popupSrc]]) {
    assert.match(src, /useDemoAutoWipe\(activeWalletId, refresh\)/, `${label} enforces demo expiry`);
}
assert.match(autoWipeSrc, /setInterval\(tick, 60_000\)/, 'demo expiry checks every minute');

console.log('demo-disclosure-on-home smoke OK');
