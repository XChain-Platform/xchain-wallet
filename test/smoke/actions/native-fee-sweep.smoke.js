// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the PC-51 sweep: every quotable authoring form mounts the shared
// NativeFeeToggle through the useNativeFee hook and threads the flag into its
// flow, and every quotable flow forwards it into submitAction's encoderOpts.
// Guards the "one form forgot one lane" regression class the hook exists to
// prevent, and pins the NativeFeeToggle doc to the quotable-set rule (the
// stale ISSUE/ORDER/SWAP/DISPENSER-only claim must not come back).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');
const routes = (f) => read('packages', 'core', 'src', 'shared', 'routes', f);
const flows = (f) => read('packages', 'core', 'src', 'flows', f);

// ---- forms newly threaded by the sweep: toggle mounted via the hook, flag
// present in every payload it builds ----
const SWEEP_FORMS = [
    'CreateOrderForm.jsx', 'DividendForm.jsx', 'AirdropForm.jsx',
    'BroadcastForm.jsx', 'ListCreateForm.jsx', 'ListForkForm.jsx',
    'DestroyForm.jsx', 'LinkForm.jsx', 'SleepForm.jsx',
    'PublishFileForm.jsx', 'AttachContentForm.jsx', 'OracleForm.jsx',
    'CallbackForm.jsx', 'SweepForm.jsx', 'TokenAdminForm.jsx',
];
for (const f of SWEEP_FORMS) {
    const src = routes(f);
    assert.match(src, /import \{ useNativeFee \}/, `${f} uses the useNativeFee hook`);
    assert.match(src, /<NativeFeeToggle/, `${f} renders the toggle`);
    assert.match(src, /payFeeInNativeCoin: nativeFee\.flag/, `${f} threads nativeFee.flag into its payloads`);
}

// ---- pre-PC-51 toggle forms migrated onto the shared hook ----
const MIGRATED = [
    ['routes', 'IssueTokenForm.jsx'], ['routes', 'SwapForm.jsx'],
    ['routes', 'DispenserForm.jsx'], ['routes', 'TokenWizard.jsx'],
    ['routes', 'AdvancedActionsForm.jsx'], ['routes', 'MintForm.jsx'],
    ['components', 'PlaceOrderPanel.jsx'],
];
for (const [dir, f] of MIGRATED) {
    const src = read('packages', 'core', 'src', 'shared', dir, f);
    assert.match(src, /useNativeFee\(\)/, `${f} state comes from useNativeFee`);
    assert.doesNotMatch(
        src, /useState\(false\);?\s*\/\/.*native/i,
        `${f} no longer hand-rolls the toggle state`,
    );
}

// ---- flows: the encoder opt reaches submitAction ----
const SWEEP_FLOWS = [
    'dividendAction.js', 'airdropAction.js', 'broadcastAction.js',
    'createList.js', 'destroyToken.js', 'linkAction.js', 'sleepAction.js',
    'fileAction.js', 'oraclePriceAction.js', 'callbackAction.js', 'sweepToken.js',
];
for (const f of SWEEP_FLOWS) {
    assert.match(
        flows(f),
        /opts\.payFeeInNativeCoin !== undefined && \{ payFeeInNativeCoin: opts\.payFeeInNativeCoin \}/,
        `${f} forwards payFeeInNativeCoin into encoderOpts`,
    );
}

// ---- component doc pinned to the quotable-set rule ----
const toggle = read('packages', 'core', 'src', 'shared', 'components', 'NativeFeeToggle.jsx');
assert.match(toggle, /classifyFeeQuoteAction/, 'NativeFeeToggle doc cites the indexer classifier');
assert.doesNotMatch(
    toggle, /Only mount this on create actions the indexer can price \(ISSUE/,
    'stale four-action mount rule removed',
);

// ---- the gated (BATCH) lane stays toggle-free: BATCH is fee-quote DENIED ----
const gated = routes('GatedPublishForm.jsx');
assert.doesNotMatch(gated, /<NativeFeeToggle/, 'GatedPublishForm (BATCH lane) has no toggle');
const batchComposer = routes('BatchComposerForm.jsx');
assert.doesNotMatch(batchComposer, /<NativeFeeToggle/, 'BatchComposerForm (BATCH) has no toggle');

console.log('native-fee-sweep smoke: all assertions passed');
