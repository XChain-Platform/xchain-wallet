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

// 6. DeveloperModeSection mounts the new RegtestNetworksRow and the
//    inner activation form calls activateChainRequest with password.
assert.ok(/RegtestNetworksRow/.test(sectionSrc),
    'DeveloperModeSection mounts RegtestNetworksRow');
assert.ok(/networkKind === 'regtest'/.test(sectionSrc),
    'DeveloperModeSection filters chainRegistry to regtest descriptors');
assert.ok(/messaging\.activateChainRequest\(/.test(sectionSrc),
    'DeveloperModeSection calls activateChainRequest');
assert.ok(/disabled=\{disabled \|\| open\}/.test(sectionSrc) || /disabled=\{!developerMode\}/.test(sectionSrc),
    'DeveloperModeSection greys out the Activate button when Developer Mode is off');

console.log('OK: activateChain flow + host + messaging shims + Settings UI smoke');
