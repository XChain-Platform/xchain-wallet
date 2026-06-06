// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for Cluster B Step 2 — G025 — Verify Signature route.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const formSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'VerifySignatureForm.jsx'),
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

assert.match(formSrc, /export function VerifySignatureForm/, 'exports VerifySignatureForm');
assert.match(formSrc, /messaging\.verifyMessageRequest/, 'calls verifyMessageRequest');
assert.match(formSrc, /<ChainPicker/, 'has chain picker');
assert.match(formSrc, /chainRegistry\.list\(\)/, 'chains come from registry, not wallet');
assert.match(formSrc, /label="Address"/, 'has address input');
assert.match(formSrc, /id="verify-message"/, 'message textarea present');
assert.match(formSrc, /id="verify-signature"/, 'signature textarea present');
assert.match(formSrc, /Signature is valid for this address/, 'valid copy');
assert.match(formSrc, /Signature does NOT match/, 'invalid copy');
assert.match(formSrc, /role="status"/, 'result row has status role');
assert.match(formSrc, /aria-live="polite"/, 'result row is aria-live');

// No password input — verify is pure.
assert.equal(/type="password"/.test(formSrc), false, 'no password field');

// --- host handler -----------------------------------------------------

assert.match(
    hostSrc,
    /host\.register\('auth\.verifyMessage'/,
    'host registers auth.verifyMessage',
);
assert.match(
    hostSrc,
    /sdk\.auth\.verifyMessage\(address, message, signature\)/,
    'invokes SDK auth.verifyMessage with positional args',
);
assert.match(
    hostSrc,
    /try \{[\s\S]*?valid = Boolean\(sdk\.auth\.verifyMessage[\s\S]*?\)/,
    'wraps SDK call so malformed signatures return valid=false',
);

// --- messaging wrappers -----------------------------------------------

for (const [src, name] of [
    [webMessagingSrc, 'web'],
    [popupMessagingSrc, 'popup'],
]) {
    assert.match(
        src,
        /export function verifyMessageRequest/,
        `${name} messaging exports verifyMessageRequest`,
    );
    assert.match(
        src,
        /sendMessage\('auth\.verifyMessage'/,
        `${name} messaging dispatches auth.verifyMessage`,
    );
}

// --- App wiring -------------------------------------------------------

for (const [src, name] of [
    [webAppSrc, 'web'],
    [popupAppSrc, 'popup'],
]) {
    assert.match(
        src,
        /import \{ VerifySignatureForm \}/,
        `${name} App imports VerifySignatureForm`,
    );
    assert.match(
        src,
        /unlockedView === 'verify-signature'/,
        `${name} App has verify-signature branch`,
    );
    assert.match(
        src,
        /onVerifySignature: \(\) => setUnlockedView\('verify-signature'\)/,
        `${name} App passes onVerifySignature`,
    );
    assert.match(
        src,
        /id: 'verify-signature'[\s\S]*onSelect: onVerifySignature/,
        `${name} App lists Verify signature in ActionsMenu`,
    );
}

console.log('verify-signature smoke OK');
