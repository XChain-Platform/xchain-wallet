// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Cluster B Step 1, G024: Sign Message route.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const formSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'SignMessageForm.jsx'),
    'utf8',
);
const hostSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
const webMessagingSrc = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'messaging.js'),
    'utf8',
);
const popupMessagingSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js'),
    'utf8',
);
const webAppSrc = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'App.jsx'),
    'utf8',
);
const popupAppSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'App.jsx'),
    'utf8',
);

// --- form structure ---------------------------------------------------

assert.match(formSrc, /export function SignMessageForm/, 'exports SignMessageForm');
assert.match(formSrc, /messaging\.signMessageRequest/, 'calls messaging.signMessageRequest');
assert.match(formSrc, /messaging\.getAddressesByChain/, 'loads chain/address map');
assert.match(formSrc, /<ChainPicker/, 'uses ChainPicker for chain selection');
assert.match(formSrc, /<select[\s\S]*aria-label="Address"/, 'has address select');
assert.match(formSrc, /<textarea/, 'has message textarea');
assert.match(
    formSrc,
    /label="Wallet password"/,
    'has password input',
);
assert.match(formSrc, /CopyButton/, 'has copy-signature affordance');
assert.match(
    formSrc,
    /InvalidPasswordError[\s\S]*Incorrect password/,
    'maps InvalidPasswordError to user-friendly copy',
);
assert.match(formSrc, /Sign another message/, 'post-sign reset path');

// --- host handler -----------------------------------------------------

assert.match(hostSrc, /signMessageFlow/, 'host destructures signMessageFlow from flows');
assert.match(
    hostSrc,
    /host\.register\('auth\.signMessage'/,
    'host registers auth.signMessage',
);
assert.match(
    hostSrc,
    /address\.source === 'hd'/,
    'host distinguishes HD vs imported addresses',
);
assert.match(
    hostSrc,
    /path: isHd \? address\.derivationPath : undefined/,
    'host routes HD addresses via path',
);
assert.match(
    hostSrc,
    /addressId: isHd \? undefined : addressId/,
    'host routes imported addresses via addressId',
);

// --- messaging wrappers -----------------------------------------------

for (const [src, name] of [
    [webMessagingSrc, 'web'],
    [popupMessagingSrc, 'popup'],
]) {
    assert.match(
        src,
        /export function signMessageRequest/,
        `${name} messaging exports signMessageRequest`,
    );
    assert.match(
        src,
        /sendMessage\('auth\.signMessage'/,
        `${name} messaging dispatches auth.signMessage`,
    );
}

// --- App wiring -------------------------------------------------------

for (const [src, name] of [
    [webAppSrc, 'web'],
    [popupAppSrc, 'popup'],
]) {
    assert.match(
        src,
        /import \{ SignMessageForm \}/,
        `${name} App imports SignMessageForm`,
    );
    assert.match(
        src,
        /unlockedView === 'sign-message'/,
        `${name} App has sign-message branch`,
    );
    assert.match(
        src,
        /onSignMessage: \(\) => setUnlockedView\('sign-message'\)/,
        `${name} App passes onSignMessage to ActionsMenu`,
    );
    assert.match(
        src,
        /id: 'sign-message'[\s\S]*onSelect: onSignMessage/,
        `${name} App buildActionEntries lists Sign message entry`,
    );
}

console.log('sign-message smoke OK');
