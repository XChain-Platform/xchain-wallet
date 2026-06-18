// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §20 Cluster X Step 2: `useWalletMode` hook + generic
// `buildActionPsbt` flow + `action.psbt` host handler + three messaging
// shims. This is the foundation that lets subsequent steps adopt
// watcher-mode read-only across every non-Send action surface.
//
// Pins:
//   - flows/buildActionPsbt.js exports `buildActionPsbt`, takes
//     `{ chainId, from, actionData, encoderOpts? }`, calls
//     `sdk.actions.createAction(actionData)` + `encoder.createTx(...)`,
//     and never imports / calls a signer / vault / broadcast.
//   - flows/index.js re-exports `buildActionPsbt`.
//   - createBackgroundHost destructures `buildActionPsbt` and registers
//     `action.psbt` with chainRegistry + sdkRegistry deps only (no vault).
//   - All three messaging shims expose `buildActionPsbtRequest(opts)`
//     calling `action.psbt`.
//   - shared/hooks/useWalletMode.js exports `useWalletMode`, derives
//     `walletMode` from settings with `WALLET_MODE_DEFAULT` fallback,
//     returns `{ walletMode, isFullMode, isWatcherMode, isSignerMode }`.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const flowSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'buildActionPsbt.js'),
    'utf8',
);
const flowsIndexSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'index.js'),
    'utf8',
);
const hostSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
const popupShimSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js'),
    'utf8',
);
const webShimSrc = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'messaging.js'),
    'utf8',
);
const desktopShimSrc = readFileSync(
    join(wsRoot, 'packages', 'desktop', 'renderer', 'messaging.js'),
    'utf8',
);
const hookSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'hooks', 'useWalletMode.js'),
    'utf8',
);

// ─── 1. flows/buildActionPsbt.js -----------------------------------

assert.match(flowSrc, /export async function buildActionPsbt\(opts\)/, 'flow exports buildActionPsbt');
assert.match(flowSrc, /sdk\.actions\.createAction\(opts\.actionData\)/, 'creates action via sdk.actions.createAction');
assert.match(flowSrc, /encoder\.createTx\(\{/, 'calls encoder.createTx');
assert.match(flowSrc, /psbtHex: encoded\.psbt,/, 'returns psbtHex');
assert.match(flowSrc, /actionData\.action/, 'validates actionData.action');
assert.match(flowSrc, /actionData\.params/, 'validates actionData.params');
// Watcher mode never broadcasts: guard against accidental signing / broadcast.
assert.doesNotMatch(flowSrc, /import [\s\S]*signers\//, 'flow does not import any signer module');
assert.doesNotMatch(flowSrc, /signer\.signPsbt/, 'no signer.signPsbt call in the flow');
assert.doesNotMatch(flowSrc, /\.broadcastTx\(/, 'no broadcastTx call in the flow');
assert.doesNotMatch(flowSrc, /\bunlockWallet\(/, 'no unlockWallet call in the flow');

// ─── 2. flows/index.js re-export ----------------------------------

assert.match(
    flowsIndexSrc,
    /export \{ buildActionPsbt \} from '\.\/buildActionPsbt\.js';/,
    'flows/index re-exports buildActionPsbt',
);

// ─── 3. createBackgroundHost wiring -------------------------------

assert.match(hostSrc, /\n\s*buildActionPsbt,\n/, 'host destructures buildActionPsbt from flows');
const handlerIdx = hostSrc.indexOf("host.register('action.psbt'");
assert.notEqual(handlerIdx, -1, 'action.psbt handler registered');
const handlerBlock = hostSrc.slice(handlerIdx, handlerIdx + 320);
assert.match(handlerBlock, /chainRegistry, sdkRegistry/, 'handler uses chainRegistry + sdkRegistry deps only');
assert.match(handlerBlock, /buildActionPsbt\(\{ \.\.\.req, chainRegistry, sdkRegistry \}\)/, 'handler forwards to buildActionPsbt');
assert.doesNotMatch(handlerBlock, /\bvault\b/, 'handler does not require vault: no unlock');

// ─── 4. Three messaging shims -------------------------------------

for (const [name, src] of [
    ['popup', popupShimSrc],
    ['web', webShimSrc],
    ['desktop', desktopShimSrc],
]) {
    assert.match(
        src,
        /export function buildActionPsbtRequest\(opts\)/,
        `${name} shim exports buildActionPsbtRequest`,
    );
    assert.match(
        src,
        /sendMessage\('action\.psbt', opts\)/,
        `${name} shim routes to action.psbt`,
    );
}

// ─── 5. useWalletMode hook ----------------------------------------

assert.match(
    hookSrc,
    /import \{ WALLET_MODE_DEFAULT \} from '\.\.\/\.\.\/schemas\/settings\.js';/,
    'useWalletMode imports WALLET_MODE_DEFAULT',
);
assert.match(
    hookSrc,
    /import \{ useSettings \} from '\.\/useSettings\.js';/,
    'useWalletMode reads settings via useSettings',
);
assert.match(hookSrc, /export function useWalletMode\(\)/, 'useWalletMode exported');
assert.match(
    hookSrc,
    /settings\?\.walletMode \|\| WALLET_MODE_DEFAULT/,
    'falls back to default mode when settings absent / loading',
);
assert.match(hookSrc, /isFullMode: walletMode === 'full'/, 'isFullMode flag');
assert.match(hookSrc, /isWatcherMode: walletMode === 'watcher'/, 'isWatcherMode flag');
assert.match(hookSrc, /isSignerMode: walletMode === 'signer'/, 'isSignerMode flag');

console.log('build-action-psbt-foundation smoke OK');
