// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-25 (gated-content publisher): the gatedPublishAction
// flow composes an atomic BATCH(FILE gated, MESSAGE v2 to self) with
// post-broadcast key custody; the gatedKeys vault collection exists with
// the keyHex-stripping list handler; the GatedPublishForm is owner-
// gated off ManageToken and wired in all three shells with HW +
// watcher signing parity.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- Flow: composition + custody ordering -----------------------------
const flow = read('packages', 'core', 'src', 'flows', 'gatedPublishAction.js');
assert.match(flow, /'FILE', '0',[\s\S]*?gate,\s*'1', \/\/ ENCRYPTION_METHOD/, 'FILE sub-action carries GATE_TICKER + method 1');
assert.match(flow, /\['MESSAGE', '2', coin, source\.address, handoff\.ciphertext\]/, 'MESSAGE v2 is addressed to SELF');
assert.match(flow, /serializeKeyPayload\(\[key\]\)/, 'handoff payload is the SDK 0x01||K format');
assert.match(flow, /eciesEncryptBytes\(handoffPayload, source\.publicKey\)/, 'handoff ECIES-encrypted to the issuer pubkey (HW-safe)');
assert.match(flow, /action: 'BATCH'/, 'publishes as one atomic BATCH');
assert.match(flow, /rawData: ciphertext\.toString\('binary'\)/, 'ciphertext rides rawData');
// Custody: confirmation holds K in memory and a successful submit persists it.
assert.match(flow, /const result = await submitAction\([\s\S]*?await persistGeneratedKey\(opts\.vault, prepared\.generatedKey\)/,
    'K persisted after submit succeeds');
assert.match(flow, /rememberGeneratedKey\(prepared\.generatedKey\)/,
    'confirmation stages K without creating a vault row');
assert.match(flow, /verifyKey\(key, keyHash\)/, 'stored pack key re-verified against its hash before reuse');
assert.match(flow, /export async function buildGatedPublishPsbtRequest/, 'watcher encode-only path exists');
assert.match(flow, /maxGatedPlaintextBytes\(/, 'encoding-aware plaintext ceiling enforced (PC-28)');
assert.ok(flow.indexOf('maxGatedPlaintextBytes({') < flow.indexOf('encryptWithKey'),
    'ceiling checked before any encryption/compose work');

// ---- Vault: schema + registration + codec ------------------------------
const schema = read('packages', 'core', 'src', 'schemas', 'gatedKey.js');
assert.match(schema, /SECRET-BEARING RECORD/, 'schema documents the secret');
assert.match(schema, /export function gatedKeyMetadata/, 'metadata stripper exists');
assert.match(schema, /keyHex, \.\.\.meta/, 'stripper removes keyHex');
const vault = read('packages', 'core', 'src', 'storage', 'Vault.js');
assert.match(vault, /this\.gatedKeys = makeCollection\(\s*this,\s*'gatedKeys',\s*migrateGatedKey,\s*validateGatedKey,?\s*\)/, 'vault collection registered');
const codec = read('packages', 'core', 'src', 'storage', 'codec.js');
assert.match(codec, /gatedKeys: \[\]/, 'codec empty document includes gatedKeys');
assert.match(codec, /gatedKeys: parsed\.gatedKeys \?\? empty\.gatedKeys/, 'codec decode preserves gatedKeys');

// ---- Host handlers ------------------------------------------------------
const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(host, /host\.register\('action\.gatedPublish',/, 'software handler');
assert.match(host, /registerHwHandler\('action\.gatedPublish\.hw', gatedPublishAction\)/, 'HW handler');
assert.match(host, /host\.register\('action\.gatedPublish\.composeForConfirm',/, 'confirm composer handler');
assert.match(host, /host\.register\('action\.gatedPublish\.psbt',/, 'watcher encode-only handler');
assert.match(host, /host\.register\('gatedKeys\.list',/, 'pack list handler');
assert.match(host, /schemas\.gatedKey\.gatedKeyMetadata\(r\)/, 'list handler strips keyHex via the schema helper');

// ---- Messaging exports x3 shells ---------------------------------------
for (const [label, ...p] of [
    ['web', 'packages', 'web', 'src', 'messaging.js'],
    ['desktop', 'packages', 'desktop', 'renderer', 'messaging.js'],
    ['extension', 'packages', 'extension', 'src', 'popup', 'messaging.js'],
]) {
    const m = read(...p);
    for (const fn of ['gatedPublishAction', 'gatedPublishActionHw', 'composeGatedPublishForConfirm', 'buildGatedPublishPsbtRequest', 'listGatedKeys']) {
        assert.match(m, new RegExp(`export function ${fn}\\(`), `${label}: exports ${fn}`);
    }
    assert.match(m, /sendMessage\('action\.gatedPublish', /, `${label}: routes to action.gatedPublish`);
}

// ---- Form ---------------------------------------------------------------
const form = read('packages', 'core', 'src', 'shared', 'routes', 'GatedPublishForm.jsx');
// The gate token (and its chain) is chosen on the form, so packs follow the picked token.
assert.match(form, /listGatedKeys\(\{ walletId, chainId: selectedChainId, gateTicker: gateTick \}\)/, 'pack picker lists vault packs');
assert.match(form, /existingKeyHash: packChoice/, 'pack reuse threads existingKeyHash');
// User-facing copy lives in the English locale; the form renders it through t().
const { en } = await import(join(wsRoot, 'packages', 'core', 'src', 'i18n', 'locales', 'en', 'index.js'));
// Permanence is stated on the confirm screen, not gated by a checkbox.
assert.doesNotMatch(form, /ackForever|<Checkbox/, 'no acknowledgement checkbox gates the publish');
assert.match(form, /notice: `\$\{upload\.confirmLine\} \$\{t\('gatedPublish\.confirmNotice', \{ tick: gateTick \}\)\}`/,
    'confirm screen names the upload method and carries the permanence notice');
assert.match(en['gatedPublish.confirmNotice'], /stays on the blockchain for good/, 'permanence notice copy');
assert.match(form, /buildGatedPublishPsbtRequest\(base\)/, 'watcher branch uses the encode-only path');
assert.match(form, /useActionConfirmFlow\(\{ messaging, walletId \}\)/, 'full wallets use the shared confirm flow');
// G98: the Advanced section's options ride the compose call.
assert.match(form, /composeGatedPublishForConfirm\(withAdvancedOptions\(base\)\)/, 'confirm compose prepares the encrypted action host-side');
assert.match(form, /prebuiltActionData: composed\.gatedPublish\.actionData/, 'approve signs the prepared action bytes');
assert.match(form, /<ActionConfirmScreen/, 'form swaps to the shared confirm page');
assert.match(form, /ownerMissing/, 'blocks when the wallet lacks the owner address');
assert.match(form, /t\('gatedPublish\.packKeyHash'\)/, 'done screen labels KEY_HASH through t()');
assert.match(en['gatedPublish.packKeyHash'], /Pack key hash/, 'done screen surfaces KEY_HASH');
assert.match(form, /ResultScreen/, 'signed but unbroadcast publishes use the queued-result state');

// ---- ManageToken entry + 3-shell wiring ---------------------------------
// The issuer's actions are groups on the one asset page (TokenOwnerActions.jsx).
const manage = read('packages', 'core', 'src', 'shared', 'components', 'TokenOwnerActions.jsx');
assert.match(manage, /id: 'gated-content'[^\n]*\.\.\.ownerAction\(options\.onGatedContent\)/,
    'ManageToken action is owner-gated');
assert.match(manage, /const ownerAction = \(handler\) => \(\{[\s\S]*?onSelect: handler,[\s\S]*?disabled: typeof handler !== 'function'/,
    'ManageToken owner action helper leaves authorization to form preflight');
for (const [label, ...p] of [
    ['web', 'packages', 'web', 'src', 'App.jsx'],
    ['desktop', 'packages', 'desktop', 'renderer', 'App.jsx'],
    ['extension', 'packages', 'extension', 'src', 'popup', 'App.jsx'],
]) {
    const app = read(...p);
    assert.match(app, /onGatedContent: \(ctx\) => openOwnerForm\('gated-publish', ctx\)/, `${label}: issuer handler wired`);
    assert.match(app, /unlockedView === 'gated-publish' && activeWalletId && tokenDetailRef/, `${label}: view routed`);
    assert.match(app, /'attach-content' \| 'gated-publish' \|/, `${label}: view union updated`);
}

console.log('gated-publish smoke: all assertions passed');
