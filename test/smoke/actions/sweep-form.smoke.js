// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-34 (dedicated SWEEP form + migrate gate): a SweepForm
// reachable from ActionsMenu + palette in all three shells, with the
// five category checkboxes at protocol defaults, an API-derived
// INDICATIVE preview, typed-SWEEP confirm, a loud third-party
// destination warning, force-close interplay with PC-16 (consents +
// reservation holds), and the MigrateToBip39 sweep step whose gated-key
// gate verifies vault custody (scan for software signers, degraded
// warning for HW / watch-only) and re-scopes keys to the new wallet.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- The form itself ----------------------------------------------------
const form = read('packages', 'core', 'src', 'shared', 'routes', 'SweepForm.jsx');
assert.match(form, /submitMethods: \{ hw: 'sweepTokenHw', software: 'sweepToken' \}/,
    'three-way signer dispatch rides useActionForm');
assert.match(form, /key: 'balances', label: [^,]+, defaultOn: true/, 'balances default ON');
assert.match(form, /key: 'ownerships', label: [^,]+, defaultOn: true/, 'ownerships default ON');
assert.match(form, /key: 'orders', label: [^,]+, defaultOn: false/, 'orders default OFF');
assert.match(form, /key: 'swaps', label: [^,]+, defaultOn: false/, 'swaps default OFF');
assert.match(form, /key: 'dispensers', label: [^,]+, defaultOn: false/, 'dispensers default OFF');
assert.match(form, /toUpperCase\(\) === 'SWEEP'/, 'typed-SWEEP confirm gates signing');
assert.match(form, /sweepPreview\(\{ chainId, address \}\)/, 'API-derived preview wired');
assert.match(form, /including anything the preview did not list|including anything not listed/,
    'typed-confirm copy covers unlisted holdings (preview is indicative)');
assert.match(form, /thirdPartyDestination/, 'third-party destination detection present');
assert.match(form, /not one of this wallet's addresses/,
    'loud third-party warning copy present');
assert.match(form, /destinationAddressError/, 'checksum-level destination validation');
assert.match(form, /gatedTickWarningCopy\(tick, 'sweep recipients'\)/,
    'PC-26 warning leg: sweep hands off no unlock keys');
assert.match(form, /copyGatedKeysToWallet/, 'migrate gate re-scopes keys to the new wallet');
assert.match(form, /gatedContentScan/, 'migrate gate runs the PC-26 recovery scan');
assert.match(form, /listGatedKeys/, 'gate checks vault custody before prompting');
assert.match(form, /cannot run the key recovery scan/,
    'HW / watch-only degrade to a per-tick warning (§5 signer note)');
assert.match(form, /ackMissingKeys/, 'missing keys need an explicit acknowledgment');
assert.match(form, /WatcherResultPanel/, 'watcher (encode-only) result surface');
assert.match(form, /SignCredentials/, 'standard signing surface used');
assert.match(form, /prebuiltPsbt/, ' single-encode confirm path forwards the composed PSBT');
assert.match(form, /1-hour (close )?window/, 'dispenser close-window delay stated');

// ---- Flow layer ---------------------------------------------------------
const flow = read('packages', 'core', 'src', 'flows', 'sweepToken.js');
assert.match(flow, /disableAutopayForAddress/, 'force-close disables the address consents');
assert.match(flow, /releaseByAddress/, 'force-close releases address-tagged holds');
assert.match(flow, /orders && broadcastTxid/, 'cleanup runs only after a broadcast with ORDERS=1');
assert.match(flow, /prebuiltPsbt: opts.prebuiltPsbt/, 'prebuilt PSBT rides to submitAction');

const preview = read('packages', 'core', 'src', 'flows', 'sweepPreview.js');
assert.match(preview, /getTokens\(trimmed, 'address'\)/, 'ownerships from the owner-scoped tokens endpoint');
assert.match(preview, /getDispensers\(trimmed, 'source'\)/, 'dispensers scoped to the source');
assert.match(preview, /error: e\?\.message/, 'per-category degradation, never a whole-preview failure');
assert.match(preview, /gatedTicks/, 'gated-tick detection feeds the warning leg + migrate gate');

const ledger = read('packages', 'core', 'src', 'flows', 'reservationLedger.js');
assert.match(ledger, /releaseByAddress/, 'ledger gains the address-scoped release');
const watcher = read('packages', 'core', 'src', 'notifications', 'CoinpayAutopayWatcher.js');
assert.match(watcher, /address: consent.sourceAddress/, 'auto-pay holds carry the paying address tag');

// ---- Host + messaging ---------------------------------------------------
const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(host, /host.register\('sweep.preview'/, 'preview host route registered');
assert.match(host, /registerHwHandler\('action.sweep.hw', sweepToken\)/, 'HW sweep route registered');
assert.match(host, /host.register\('gatedKeys.copyToWallet'/, 'key re-scope route registered');
assert.match(host, /sweepToken\(\{ \.\.\.req, signer: await sessionSigner\(req, vault, signerPool\), vault, chainRegistry, sdkRegistry, reservationLedger \}\)/,
    'software sweep route passes the shared reservation ledger');

for (const shell of [
    ['packages', 'web', 'src', 'messaging.js'],
    ['packages', 'desktop', 'renderer', 'messaging.js'],
    ['packages', 'extension', 'src', 'popup', 'messaging.js'],
]) {
    const src = read(...shell);
    for (const route of ["'action.sweep'", "'action.sweep.hw'", "'sweep.preview'", "'gatedKeys.copyToWallet'"]) {
        assert.ok(src.includes(route), `${shell.join('/')} exposes ${route}`);
    }
}

// ---- Shell wiring -------------------------------------------------------
for (const shell of [
    ['packages', 'web', 'src', 'App.jsx'],
    ['packages', 'desktop', 'renderer', 'App.jsx'],
    ['packages', 'extension', 'src', 'popup', 'App.jsx'],
]) {
    const src = read(...shell);
    assert.ok(src.includes('SweepForm'), `${shell.join('/')} imports SweepForm`);
    assert.ok(src.includes("unlockedView === 'sweep'"), `${shell.join('/')} routes the sweep view`);
    assert.ok(src.includes('onSweep:'), `${shell.join('/')} ActionsMenu offers Sweep`);
    assert.ok(src.includes('onSweepChain='), `${shell.join('/')} wires the migrate sweep step`);
    assert.ok(src.includes('migrateTo:'), `${shell.join('/')} migrate lane passes the new-wallet target`);
}

// ---- Migrate wizard -----------------------------------------------------
const migrate = read('packages', 'core', 'src', 'shared', 'routes', 'MigrateToBip39.jsx');
assert.match(migrate, /onSweepChain/, 'wizard exposes the per-chain sweep step');
assert.match(migrate, /Sweep this chain/, 'done screen offers one-tap sweep per chain');
assert.ok(!/doesn't\s+exist yet/.test(migrate) && !/SweepForm surface that doesn'?t/.test(migrate),
    'stale "SweepForm does not exist" claim removed (§14 rule 3)');

// ---- Palette + advanced decoration --------------------------------------
const palette = read('packages', 'core', 'src', 'shared', 'commandPalette', 'commandRegistry.js');
assert.match(palette, /id: 'create-sweep'/, 'command palette reaches the sweep form');
const advanced = read('packages', 'core', 'src', 'shared', 'routes', 'AdvancedActionsForm.jsx');
assert.match(advanced, /'LINK', 'SWEEP',?\s*\]\)/, 'SWEEP restored to ACTIONS_WITH_DEDICATED_FORMS (PC-56 stale-label fix closed)');

console.log('sweep-form smoke: all assertions passed');
