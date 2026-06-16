// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §27.3 / §27.4 / Cluster I FOLLOWUP 1 smoke — Settings → Display panel.
//
// Asserts:
//   1. DisplaySection.jsx exists, exports DisplaySection, and reads
//      pinnedTokens + hiddenTokens off settings via useSettings.
//   2. Pinned section ships ↑ / ↓ reorder buttons, an Unpin (✕)
//      affordance, and writes the new array via update().
//   3. Hidden section ships per-row Unhide + a bulk Unhide-all button
//      that writes [] when invoked.
//   4. Each interactive control has an aria-label so assistive tech
//      can identify the row it acts on.
//   5. Settings.jsx mounts DisplaySection as an internal-drill section
//      with the documented summary helper + search keywords.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. DisplaySection file shape -------------------------------------

const sectionPath = join(
    wsRoot,
    'packages', 'core', 'src', 'shared', 'components', 'settings', 'DisplaySection.jsx',
);
assert.ok(existsSync(sectionPath), 'DisplaySection.jsx exists');
const sectionSrc = readFileSync(sectionPath, 'utf8');
assert.ok(/export function DisplaySection\(/.test(sectionSrc),
    'DisplaySection is a named export');
assert.ok(/import \{ useSettings \} from '\.\.\/\.\.\/hooks\/useSettings\.js'/.test(sectionSrc),
    'DisplaySection reads + writes via the shared useSettings hook');
assert.ok(/settings\?\.pinnedTokens/.test(sectionSrc),
    'DisplaySection reads pinnedTokens off settings');
assert.ok(/settings\?\.hiddenTokens/.test(sectionSrc),
    'DisplaySection reads hiddenTokens off settings');

// --- 2. Pinned section: reorder + unpin write through update() --------

assert.ok(/function movePin\(idx, delta\)/.test(sectionSrc) ||
    /const movePin = useCallback\(\(idx, delta\)/.test(sectionSrc),
    'movePin handler accepts (idx, delta) for ↑ / ↓ reorder');
assert.ok(/writePinned\(next\)/.test(sectionSrc),
    'movePin writes the reordered array via writePinned');
assert.ok(/update\(\{ pinnedTokens: next \}\)/.test(sectionSrc),
    'pinned writes go through update({ pinnedTokens })');
assert.ok(/aria-label=\{`Move \$\{key\} up`\}/.test(sectionSrc),
    'each ↑ row carries an aria-label naming the key it moves');
assert.ok(/aria-label=\{`Move \$\{key\} down`\}/.test(sectionSrc),
    'each ↓ row carries an aria-label naming the key it moves');
assert.ok(/aria-label=\{`Unpin \$\{key\}`\}/.test(sectionSrc),
    'each unpin row carries an aria-label naming the key it removes');
assert.ok(/disabled=\{idx === 0\}/.test(sectionSrc),
    '↑ button disables for the first row');
assert.ok(/disabled=\{idx === pinned\.length - 1\}/.test(sectionSrc),
    '↓ button disables for the last row');

// --- 3. Hidden section: per-row + bulk unhide -------------------------

assert.ok(/update\(\{ hiddenTokens: next \}\)/.test(sectionSrc),
    'hidden writes go through update({ hiddenTokens })');
assert.ok(/const unhide = useCallback\(\(key\)/.test(sectionSrc) ||
    /function unhide\(key\)/.test(sectionSrc),
    'per-row unhide handler exists');
assert.ok(/const unhideAll = useCallback/.test(sectionSrc),
    'unhideAll handler exists');
assert.ok(/writeHidden\(\[\]\)/.test(sectionSrc),
    'unhideAll writes the empty array');
assert.ok(/aria-label=\{`Unhide \$\{key\}`\}/.test(sectionSrc),
    'each per-row unhide carries an aria-label naming the key');
assert.ok(/Unhide all/.test(sectionSrc),
    'bulk Unhide-all action labelled in the UI');

// --- 4. Empty-state hints ---------------------------------------------

assert.ok(/No pinned tokens\./.test(sectionSrc),
    'empty pinned list shows the documented hint');
assert.ok(/No hidden tokens\./.test(sectionSrc),
    'empty hidden list shows the documented hint');

// --- 5. Settings.jsx mounts DisplaySection ----------------------------

const settingsSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx'),
    'utf8',
);
assert.ok(/import \{ DisplaySection \} from '\.\.\/components\/settings\/DisplaySection\.jsx'/.test(settingsSrc),
    'Settings.jsx imports DisplaySection');
assert.ok(/id: 'display',[\s\S]{0,400}?Component: DisplaySection/.test(settingsSrc),
    'Settings.jsx registers a display section bound to DisplaySection');
assert.ok(/keywords: 'display pinned hidden tokens reorder unhide bulk star'/.test(settingsSrc),
    'display section ships search keywords so it surfaces in Settings search');
assert.ok(/summary: displaySummary\(settings\)/.test(settingsSrc),
    'display section renders the displaySummary in the list view');
assert.ok(/function displaySummary\(settings\)/.test(settingsSrc),
    'displaySummary helper defined in Settings.jsx');
assert.ok(/'No customization'/.test(settingsSrc),
    'displaySummary reports "No customization" when both lists are empty');

console.log(
    'OK — display-settings-panel smoke (§27.3 / §27.4 / Cluster I FOLLOWUP 1 — DisplaySection lists pinnedTokens + hiddenTokens; ↑ / ↓ reorder + ✕ unpin + per-row Unhide + bulk Unhide-all all write through useSettings.update; aria-label on every interactive control names the affected key; Settings.jsx mounts the panel as an internal-drill with displaySummary + search keywords)',
);
