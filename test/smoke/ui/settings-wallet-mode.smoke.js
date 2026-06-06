// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §20 / G039 — Wallet Mode panel (Step 1 of 3).
//
// Pins:
//   - schemas/settings.js exports WALLET_MODES + WALLET_MODE_DEFAULT, the
//     default seed includes walletMode: 'full', and validateSettings is
//     v2-tolerant (optional walletMode rejected only when present + invalid).
//   - WalletModeSection renders a fieldset of three radio options
//     (full / watcher / signer) and writes through update({ walletMode }).
//   - Settings.jsx registers the section as an internal-drill row above
//     Backup, with a summary helper that reads settings.walletMode.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const schemaPath = join(wsRoot, 'packages', 'core', 'src', 'schemas', 'settings.js');
const sectionPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'WalletModeSection.jsx');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');

// ─── 1. Schema -----------------------------------------------------

const schemaSrc = readFileSync(schemaPath, 'utf8');
assert.match(
    schemaSrc,
    /export const WALLET_MODES = \/\*\* @type \{const\} \*\/ \(\['full', 'watcher', 'signer'\]\);/,
    'WALLET_MODES const declares the three modes',
);
assert.match(schemaSrc, /export const WALLET_MODE_DEFAULT = 'full';/, 'WALLET_MODE_DEFAULT = full');
assert.match(schemaSrc, /walletMode:\s*WALLET_MODE_DEFAULT,/, 'createDefaultSettings seeds walletMode');
assert.match(
    schemaSrc,
    /if \(r\.walletMode !== undefined\)/,
    'validate guards walletMode only when present (v2-tolerant)',
);
assert.match(
    schemaSrc,
    /isOneOf\(r\.walletMode, WALLET_MODES\)/,
    'validate rejects bogus walletMode values',
);

// ─── 2. WalletModeSection component --------------------------------

const sectionSrc = readFileSync(sectionPath, 'utf8');
assert.match(sectionSrc, /import \{ useSettings \}/, 'imports useSettings');
assert.match(
    sectionSrc,
    /import \{ WALLET_MODES, WALLET_MODE_DEFAULT \} from '\.\.\/\.\.\/\.\.\/schemas\/settings\.js';/,
    'imports WALLET_MODES + WALLET_MODE_DEFAULT from schema',
);
for (const mode of ['full', 'watcher', 'signer']) {
    assert.ok(
        new RegExp(`value:\\s*'${mode}'`).test(sectionSrc),
        `MODE_OPTIONS lists ${mode}`,
    );
}
assert.match(sectionSrc, /<fieldset/, 'wraps options in a <fieldset>');
assert.match(sectionSrc, /type="radio"/, 'renders radio inputs');
assert.match(
    sectionSrc,
    /update\(\{\s*walletMode:\s*next\s*\}\)/,
    'onChange writes through update({ walletMode })',
);
assert.match(
    sectionSrc,
    /aria-describedby=\{`walletMode-\$\{opt\.value\}-hint`\}/,
    'each radio is aria-described by its hint id',
);

// ─── 3. Settings.jsx wiring ----------------------------------------

const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(settingsSrc, /import \{ WalletModeSection \}/, 'Settings.jsx imports WalletModeSection');
assert.match(
    settingsSrc,
    /import \{ WALLET_MODE_DEFAULT \} from '\.\.\/\.\.\/schemas\/settings\.js';/,
    'Settings.jsx imports WALLET_MODE_DEFAULT for the summary helper',
);
const idx = settingsSrc.indexOf("id: 'wallet-mode'");
assert.notEqual(idx, -1, "wallet-mode section registered");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'internal-drill'/, 'wallet-mode is an internal-drill row');
assert.match(block, /Component:\s*WalletModeSection/, 'Component is WalletModeSection');
assert.match(block, /summary:\s*walletModeSummary\(settings\)/, 'summary helper wired');
assert.match(
    settingsSrc,
    /function walletModeSummary\(settings\)/,
    'walletModeSummary helper present',
);
assert.match(
    settingsSrc,
    /settings\.walletMode \|\| WALLET_MODE_DEFAULT/,
    'summary defaults missing field to WALLET_MODE_DEFAULT',
);

console.log('settings-wallet-mode smoke OK');
