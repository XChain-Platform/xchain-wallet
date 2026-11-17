// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §36 Settings > Automatic donations (ruling 2026-11-14): one
// wallet-wide fiat setting on shared inline rows, no switch, no per-network
// fields; the engine accrues after broadcast and pays the whole queue.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core', 'src');
const src = readFileSync(join(core, 'shared', 'components', 'settings', 'AdsSection.jsx'), 'utf8');
const settingsSrc = readFileSync(join(core, 'shared', 'routes', 'Settings.jsx'), 'utf8');
const adsSrc = readFileSync(join(core, 'flows', 'ads.js'), 'utf8');
const submitSrc = readFileSync(join(core, 'flows', 'submitAction.js'), 'utf8');
const composeSrc = readFileSync(join(core, 'flows', 'composeForConfirm.js'), 'utf8');
const schemaSrc = readFileSync(join(core, 'schemas', 'settings.js'), 'utf8');

assert.match(src, /import \{ useSettings \}/, 'imports useSettings');

// Shared inline rows in labelled group cards (G08), no switch.
assert.match(src, /import \{ InlineRowFrame, SettingsInlineRow \} from '\.\/SettingsInlineRow\.jsx'/, 'uses the shared inline row');
assert.ok(!/ToggleRow|<Switch|kind: 'switch'/.test(src), 'no on and off switch: None turns donations off');
for (const id of ['ads-per-transaction', 'ads-send-at', 'ads-donate-to', 'ads-queued', 'ads-donated']) {
    assert.ok(src.includes(`id: '${id}'`), `row ${id} present`);
}
assert.ok(!/perChain|perTxAmountSats|triggerAmountSats|accumulatedSats/.test(src), 'no per-network fields left on the page');

// Presets and the in-place Custom field.
assert.match(src, /presets: ADS_PER_TRANSACTION_OPTIONS/, 'per-transaction presets');
assert.match(src, /presets: ADS_SEND_AT_OPTIONS/, 'send-at presets');
assert.match(src, /inputMode="decimal"/, 'custom amount field is a decimal text field');
assert.match(schemaSrc, /ADS_PER_TRANSACTION_OPTIONS = Object\.freeze\(\['0', '0\.01', '0\.05', '0\.1', '0\.25'\]\)/, 'None, $0.01, $0.05, $0.10, $0.25');
assert.match(schemaSrc, /ADS_SEND_AT_OPTIONS = Object\.freeze\(\['5', '10', '25', '50', '100'\]\)/, '$5, $10, $25, $50, $100');
assert.match(schemaSrc, /ADS_RECIPIENTS = \/\*\* @type \{const\} \*\/ \(\['protocol', 'community', 'explorer'\]\)/, 'three recipients');

// The engine: one queue, payout by building, booking after broadcast.
assert.match(adsSrc, /export async function resolveAdsPayout/, 'payout resolver');
assert.match(adsSrc, /export async function createTxWithAdsFallback/, 'compose builds without the donation when it cannot be covered');
assert.match(adsSrc, /export function withAdsAtEncode/, 'live builds fold and fall back at the encoder');
assert.match(adsSrc, /export async function commitAdsStep/, 'post-broadcast booking');
assert.match(composeSrc, /createTxWithAdsFallback\(/, 'compose uses the fallback build');
assert.match(submitSrc, /resolveAdsPayout\(/, 'live submit resolves the payout');
const commitAt = submitSrc.indexOf('await commitAdsStep({ vault, ...adsVerdict() })');
const broadcastAt = submitSrc.indexOf('result = await submitWithSigner(');
assert.ok(broadcastAt > 0 && commitAt > broadcastAt, 'the queue is booked only after the broadcast');

// Settings.jsx wiring
assert.match(settingsSrc, /import \{ AdsSection \}/, 'Settings.jsx imports AdsSection');
const idx = settingsSrc.indexOf("id: 'ads'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'internal-drill'/);
assert.match(block, /Component:\s*AdsSection/);

console.log('settings-ads smoke OK');
