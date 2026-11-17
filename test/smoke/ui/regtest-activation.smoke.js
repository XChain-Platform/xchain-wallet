// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §48.3 / G149 Regtest chain exposure. Pins the activation
// flow surface, the host handler registration, the messaging shims
// across all three shells, and the Settings UI wiring.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const flowSrc = read('packages/core/src/flows/activateChain.js');
const flowsIndexSrc = read('packages/core/src/flows/index.js');
const hostSrc = read('packages/extension/src/background/createBackgroundHost.js');
const popupMsgSrc = read('packages/extension/src/popup/messaging.js');
const webMsgSrc = read('packages/web/src/messaging.js');
const desktopMsgSrc = read('packages/desktop/renderer/messaging.js');
const sectionSrc = read('packages/core/src/shared/components/settings/DeveloperModeSection.jsx');
const pagesSrc = read('packages/core/src/shared/components/settings/TestNetworksPages.jsx');

// 1. Flow exports `activateChain` and is re-exported from flows/index.
assert.ok(/export async function activateChain\(/.test(flowSrc),
    'activateChain.js exports the flow');
assert.ok(/export \{ activateChain \} from '\.\/activateChain\.js'/.test(flowsIndexSrc),
    'flows/index re-exports activateChain');

// 2. Flow seeds settings via the existing helper before deriving
//    addresses (so a partial signer failure still leaves the chain
//    visible in pickers).
assert.ok(/seedSettingsForChains\(settings, chainRegistry, \[chainId\]\)/.test(flowSrc),
    'activateChain seeds settings via seedSettingsForChains');
assert.ok(/await vault\.settings\.put\(seeded\)/.test(flowSrc),
    'activateChain persists the seeded settings');

// 3. Flow is HW-aware: address source tracks the signer kind (software
//    'hd', hardware 'trezor'/'ledger'), and is idempotent against accounts
//    that already have an address on the chain.
assert.ok(/signer\.kind === 'software' \? 'hd' : signer\.kind/.test(flowSrc),
    'activateChain derives address source from the signer kind (HW-aware)');
assert.ok(/alreadyHasOnChain/.test(flowSrc),
    'activateChain skips accounts that already have an address on chainId');
assert.ok(/skippedAccounts/.test(flowSrc),
    'activateChain reports skippedAccounts');

// 4. Host handler `wallet.activateChain` is registered.
assert.ok(/host\.register\('wallet\.activateChain'/.test(hostSrc),
    'createBackgroundHost registers wallet.activateChain');
assert.ok(/activateChain,/.test(hostSrc),
    'createBackgroundHost imports activateChain');

// 5. Messaging shim across all three shells.
for (const [src, name] of [
    [popupMsgSrc, 'extension popup'],
    [webMsgSrc, 'web'],
    [desktopMsgSrc, 'desktop'],
]) {
    assert.ok(/export function activateChainRequest/.test(src),
        `${name} messaging exports activateChainRequest`);
    assert.ok(/sendMessage\('wallet\.activateChain'/.test(src),
        `${name} activateChainRequest sends wallet.activateChain`);
}

// 6. Test Networks (operator picks 2026-11-14): Add Network lists the
//    built-in regtest networks not active yet and asks for the password in
//    place, then calls activateChainRequest with it. The Developer section
//    no longer carries the regtest rows.
assert.ok(!/RegtestNetworksRow/.test(sectionSrc),
    'DeveloperModeSection no longer mounts the old Regtest networks rows');
assert.ok(/export function AddNetworkPage\(/.test(pagesSrc),
    'TestNetworksPages exports the Add Network page');
assert.ok(/networkKind === 'regtest' && !d\?\.isUserAdded/.test(pagesSrc),
    'Add Network offers the built-in regtest descriptors');
assert.ok(/!isActiveOn\(settings, d\.id\)/.test(pagesSrc),
    'Add Network offers only the networks not active yet');
assert.ok(/messaging\.activateChainRequest\(/.test(pagesSrc),
    'the in-place activation calls activateChainRequest');
// The smoke loader reads source with English copy in place of t() keys.
assert.ok(/disabledReason=(?:\{t\('settings\.testNetworks\.needsDevMode'\)\}|"Turn on Developer mode first")/.test(pagesSrc),
    'activation rows stay listed with their reason while Developer Mode is off');

// 7. §17.4 / FOLLOWUP 1: the in-place activation is HW-aware. It mounts the
//    shared SignerSelectForm, branches on signer kind, threads signerId into
//    the activation request, and swaps the password field for device copy
//    when a hardware signer is selected.
assert.ok(/import \{ SignerSelectForm \} from '\.\.\/\.\.\/routes\/SignerSelectForm\.jsx'/.test(pagesSrc),
    'TestNetworksPages imports SignerSelectForm');
assert.ok(/<SignerSelectForm\b/.test(pagesSrc),
    'the in-place activation renders <SignerSelectForm> so HW-paired wallets can pick a device');
assert.ok(/const isHardware = Boolean\(signerId\)/.test(pagesSrc),
    'the in-place activation branches on signer kind via isHardware');
assert.ok(/signerId: signerId \|\| undefined/.test(pagesSrc),
    'the in-place activation threads signerId into activateChainRequest');
assert.ok(/const sendPassword = askPassword && !isHardware/.test(pagesSrc)
    && /password: sendPassword \? password : undefined/.test(pagesSrc),
    'the in-place activation omits the password for hardware signers and an unlocked session');
assert.ok(/if \(sendPassword && password\.length === 0\)/.test(pagesSrc),
    'the in-place activation only requires a wallet password for software signers with no pooled signer');
// Operator preference 2026-11-14: the session's pooled signer (the host's
// wallet.signerReady) activates at once with no password field.
assert.ok(/const signerReady = useSignerReady\(walletId\)/.test(pagesSrc)
    && /const askPassword = !signerReady \|\| poolGone/.test(pagesSrc),
    'the in-place activation asks for the password only while the signer pool is empty');
assert.ok(/settings\.testNetworks\.deviceNote/.test(pagesSrc),
    'the in-place activation shows device-check copy for hardware signers');

console.log('OK: activateChain flow + host + messaging shims + Test Networks UI + HW-aware smoke');
