// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §30.4 / Cluster E FOLLOWUP 1: HW signing path for PsbtSignForm.
//
// Pins:
//   - core/flows/signFlows.js exports `signPsbtFlow` with an injected
//     `signer` branch (skips unlockWallet, does not auto-lock).
//   - createBackgroundHost registers `auth.signPsbt.hw`, resolves the
//     Address, builds a RemoteSigner via signerBridge, decomposes
//     the PSBT, and delegates to signPsbtFlow with the injected signer.
//   - All three messaging shims expose `signPsbtUserInitiatedHw` and
//     route to `auth.signPsbt.hw`.
//   - PsbtSignForm detects HW source, mounts <HwSignBlock>, gates
//     submit on `hwStatus === 'available'`, and branches the submit
//     handler to the HW shim.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const flowSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'signFlows.js'),
    'utf8',
);
const hostSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
const popupShim = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js'),
    'utf8',
);
const webShim = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'messaging.js'),
    'utf8',
);
const desktopShim = readFileSync(
    join(wsRoot, 'packages', 'desktop', 'renderer', 'messaging.js'),
    'utf8',
);
const formSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'PsbtSignForm.jsx'),
    'utf8',
);

// ─── 1. signPsbtFlow accepts injected signer ────────────────────────────

assert.match(
    flowSrc,
    /signer:\s*injectedSigner/,
    'signPsbtFlow destructures `signer` as `injectedSigner`',
);
assert.match(
    flowSrc,
    /either `password` or `signer` is required/,
    'signPsbtFlow validates that one of password / signer is supplied',
);
assert.match(
    flowSrc,
    /const signer = injectedSigner\s*\|\|\s*await unlockWallet/,
    'signPsbtFlow uses injectedSigner when supplied, else unlockWallet',
);
assert.match(
    flowSrc,
    /if \(!injectedSigner && typeof signer\.lock === 'function'\)/,
    'signPsbtFlow only auto-locks when it owns the signer',
);

// ─── 2. host handler `auth.signPsbt.hw` ─────────────────────────────────

const handlerIdx = hostSrc.indexOf("host.register('auth.signPsbt.hw'");
assert.notEqual(handlerIdx, -1, 'auth.signPsbt.hw handler registered');
const handlerBlock = hostSrc.slice(handlerIdx, handlerIdx + 3000);
assert.match(handlerBlock, /walletId is required/, 'validates walletId');
assert.match(handlerBlock, /addressId is required/, 'validates addressId');
assert.match(handlerBlock, /psbtHex is required/, 'validates psbtHex');
assert.match(handlerBlock, /vault\.addresses\.get\(addressId\)/, 'fetches Address record');
assert.match(handlerBlock, /resolveSigner\(\{ vault, address \}\)/, 'resolves descriptor via shared helper');
assert.match(handlerBlock, /descriptor\.kind !== 'trezor' && descriptor\.kind !== 'ledger'/,
    'rejects non-HW source addresses');
assert.match(handlerBlock, /signerBridge\.getTransport\(descriptor\.signerRecord\.id\)/,
    'fetches transport from signer bridge');
assert.match(handlerBlock, /buildRemoteSigner\(descriptor, transport\)/,
    'builds RemoteSigner against the transport');
assert.match(handlerBlock, /sdk\?\.wallet\?\.decomposePsbt/, 'guards against missing decomposePsbt');
assert.match(handlerBlock, /signingPaths\.push\(\{ inputIndex: i, path: address\.derivationPath \}\)/,
    'derives signingPaths from PSBT inputs matching the address');
assert.match(handlerBlock, /signPsbtFlow\(\{[\s\S]+?signer,?\s*\}\)/,
    'delegates to signPsbtFlow with the injected signer');
// HW handler should NOT carry password
assert.doesNotMatch(handlerBlock, /password:\s*[a-zA-Z]/, 'no password threaded through');

// ─── 3. messaging shims ─────────────────────────────────────────────────

for (const [name, src] of [
    ['popup', popupShim],
    ['web', webShim],
    ['desktop', desktopShim],
]) {
    assert.match(
        src,
        /export function signPsbtUserInitiatedHw\(opts\)/,
        `${name} shim exports signPsbtUserInitiatedHw`,
    );
    assert.match(
        src,
        /sendMessage\('auth\.signPsbt\.hw', opts\)/,
        `${name} shim routes to auth.signPsbt.hw`,
    );
}

// Desktop shim now also has the prereq parsePsbtRequest + signPsbtUserInitiated
// (PsbtSignForm was being routed in desktop App.jsx but couldn't actually
// sign; the underlying shims were silently missing).
assert.match(
    desktopShim,
    /export function parsePsbtRequest\(opts\)/,
    'desktop shim exposes parsePsbtRequest (preview)',
);
assert.match(
    desktopShim,
    /export function signPsbtUserInitiated\(opts\)/,
    'desktop shim exposes signPsbtUserInitiated (software path)',
);

// ─── 4. PsbtSignForm wiring ─────────────────────────────────────────────

assert.match(
    formSrc,
    /import \{ HwSignBlock \} from '\.\.\/components\/HwSignBlock\.jsx'/,
    'PsbtSignForm imports HwSignBlock',
);
assert.match(
    formSrc,
    /import \{ useSignerInfo \} from '\.\.\/hooks\/useSignerInfo\.js'/,
    'PsbtSignForm imports useSignerInfo',
);
assert.match(
    formSrc,
    /const isHwSource = selectedAddress\?\.source === 'trezor' \|\| selectedAddress\?\.source === 'ledger'/,
    'PsbtSignForm derives isHwSource from the chosen address',
);
assert.match(
    formSrc,
    /useSignerInfo\(\{[\s\S]+?signerId: isHwSource \? selectedAddress\?\.signerId : null/,
    'PsbtSignForm wires useSignerInfo against the chosen HW signer',
);
assert.match(
    formSrc,
    /messaging\.signPsbtUserInitiatedHw\(\{[\s\S]+?walletId,[\s\S]+?addressId,[\s\S]+?psbtHex,?\s*\}\)/,
    'PsbtSignForm calls signPsbtUserInitiatedHw on the HW path',
);
assert.match(
    formSrc,
    /\(isHwSource \? hwStatus !== 'available' : password\.length === 0\)/,
    'PsbtSignForm gates submit on HW status when HW, password length when software',
);
assert.match(
    formSrc,
    /isHwSource && selectedAddress\s*\?\s*`Sign on \$\{selectedAddress\.source === 'trezor' \? 'Trezor' : 'Ledger'\}`/,
    'submit button copy switches per HW vendor',
);
assert.match(
    formSrc,
    /<HwSignBlock[\s\S]+?onStatusChange=\{onHwStatusChange\}/,
    'HwSignBlock is mounted with onStatusChange wired',
);

console.log('psbt-sign-hw smoke OK');
