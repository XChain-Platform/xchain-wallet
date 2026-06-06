// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §23.5 / G052 / Cluster O FOLLOWUP 3 — chain-filter memory
// reset UI in Settings → Display.
//
// Until v0.297.0 the per-list chain-filter memory persisted silently
// (`xc:chainFilter:*` localStorage keys) with no user-facing reset.
// DisplaySection now grows a "Reset list preferences" button that
// wipes the entire namespace, plus a one-shot status line confirming
// how many keys were cleared.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const core = join(root, 'packages', 'core');

// --- 1. clearAllChainFilters export -------------------------------------

const utilPath = join(core, 'src', 'shared', 'utils', 'chainFilterMemory.js');
assert.ok(existsSync(utilPath), 'chainFilterMemory.js exists');
const utilSrc = readFileSync(utilPath, 'utf8');
assert.ok(
    /export function clearAllChainFilters\(\)/.test(utilSrc),
    'clearAllChainFilters is a named export',
);
assert.ok(
    /localStorage\.length/.test(utilSrc) && /localStorage\.key\(i\)/.test(utilSrc),
    'sweep uses .length + .key(i) instead of Object.keys for SW/popup safety',
);
assert.ok(
    /\.startsWith\(NS\)/.test(utilSrc),
    'sweep filters by the chain-filter namespace prefix',
);
assert.ok(
    /try \{ localStorage\.removeItem\(k\); \} catch/.test(utilSrc),
    'removal is wrapped in try/catch so a single quota failure does not abort the sweep',
);
// Returns a count so the UI can confirm.
assert.ok(
    /return toRemove\.length/.test(utilSrc),
    'clearAllChainFilters returns the number of removed keys',
);
assert.ok(
    /return 0/.test(utilSrc),
    'clearAllChainFilters returns 0 when localStorage is unavailable',
);

// --- 2. Functional round-trip via a tiny localStorage stub --------------

globalThis.localStorage = {
    _data: new Map([
        ['xc:chainFilter:history', '["bitcoin"]'],
        ['xc:chainFilter:home', 'bitcoin'],
        ['xc:other-key', 'unrelated'],
    ]),
    get length() { return this._data.size; },
    key(i) { return Array.from(this._data.keys())[i] ?? null; },
    getItem(k) { return this._data.has(k) ? this._data.get(k) : null; },
    setItem(k, v) { this._data.set(k, v); },
    removeItem(k) { this._data.delete(k); },
};

const { clearAllChainFilters } = await import(utilPath);
const removed = clearAllChainFilters();
assert.equal(removed, 2, 'clearAllChainFilters removes both xc:chainFilter:* keys');
assert.equal(globalThis.localStorage._data.size, 1, 'unrelated key survives');
assert.ok(
    globalThis.localStorage._data.has('xc:other-key'),
    'unrelated key (xc:other-key) is preserved',
);

// --- 3. DisplaySection wires the button --------------------------------

const sectionPath = join(core, 'src', 'shared', 'components', 'settings', 'DisplaySection.jsx');
const section = readFileSync(sectionPath, 'utf8');
assert.ok(
    /from '\.\.\/\.\.\/utils\/chainFilterMemory\.js'/.test(section)
        && /clearAllChainFilters/.test(section),
    'DisplaySection imports clearAllChainFilters',
);
assert.ok(
    /Reset list preferences/.test(section),
    'DisplaySection ships a "Reset list preferences" button',
);
assert.ok(
    /onClick=\{resetChainFilters\}/.test(section),
    'button click calls resetChainFilters',
);
assert.ok(
    /const resetChainFilters = useCallback\(\(\) => \{[\s\S]+?clearAllChainFilters\(\)/.test(section),
    'resetChainFilters callback calls clearAllChainFilters',
);
assert.ok(
    /setResetMessage\(/.test(section),
    'callback updates a status message after the run',
);
assert.ok(
    /role="status"\s+aria-live="polite"/.test(section),
    'reset confirmation uses an aria-live status region',
);

console.log('chain-filter-reset smoke OK');
