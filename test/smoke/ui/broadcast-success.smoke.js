// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §37 / §29 / G124: Send.jsx broadcast success confirmation.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const sendJsx = join(core, 'src', 'shared', 'routes', 'Send.jsx');
const broadcastJsx = join(core, 'src', 'shared', 'routes', 'BroadcastForm.jsx');
const sendCss = join(core, 'src', 'shared', 'routes', 'Send.module.css');

assert.ok(existsSync(sendJsx), 'Send.jsx exists');
const send = readFileSync(sendJsx, 'utf8');
const broadcast = readFileSync(broadcastJsx, 'utf8');
const css = readFileSync(sendCss, 'utf8');

// --- 1. Done stage renders the new success card ---------------------------

assert.ok(/stage === 'done'/.test(send), 'Send still gates on stage === "done"');
assert.ok(/className=\{styles\.successCard\}/.test(send),
    'Done stage renders the styles.successCard wrapper');
assert.ok(/Broadcast pending/.test(send),
    'Done stage uses "Broadcast pending" copy (§28.4 status timeline language)');
assert.ok(/role="status"\s+aria-live="polite"/.test(send),
    'Done stage announces success via role=status + aria-live=polite');
assert.ok(/role="status"\s+aria-live="polite"\s+aria-atomic="true"/.test(send),
    'Done stage announces the pending result as one atomic update');

// --- 2. Send-another resets state -----------------------------------------

assert.ok(/sendAnother/.test(send),
    'Done stage exposes a sendAnother handler');
assert.ok(/setStage\('form'\)/.test(send),
    'sendAnother returns to the form stage');
assert.ok(/setAmount\(''\)/.test(send) && /setToAddress\(''\)/.test(send),
    'sendAnother clears the recipient + amount fields');

// --- 3. Explorer link wired through chainRegistry's explorer.defaultUrl ---

assert.ok(/explorer\?\.defaultUrl/.test(send),
    'Done stage reads explorer.defaultUrl from the chain descriptor');
assert.ok(/View on explorer/.test(send),
    'Done stage offers a "View on explorer" link');
assert.ok(/target="_blank"/.test(send) && /rel="noopener noreferrer"/.test(send),
    'Explorer link opens in a new tab with noopener noreferrer');

// --- 4. BROADCAST actions expose the same transaction essentials -------

assert.ok(/Your action was broadcast but is not confirmed yet/.test(broadcast),
    'BROADCAST success explains that confirmation is still pending');
assert.ok(/<CopyButton value=\{txid\} label="Copy transaction ID" \/>/.test(broadcast),
    'BROADCAST success makes the transaction ID copyable');
assert.ok(/explorerPageUrl\(\{[\s\S]*?kind: 'transaction',[\s\S]*?value: txid/.test(broadcast),
    'BROADCAST success builds a chain-scoped transaction explorer URL');
assert.ok(/Broadcast another/.test(broadcast),
    'BROADCAST success offers a repeat path');

// --- 5. Shell completion callbacks return Home -------------------------

for (const appPath of [
    join(wsRoot, 'packages', 'web', 'src', 'App.jsx'),
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'App.jsx'),
    join(wsRoot, 'packages', 'desktop', 'renderer', 'App.jsx'),
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(/<Send[\s\S]*?onDone=\{\(\) => \{[\s\S]*?setUnlockedView\('home'\)/.test(app),
        `${appPath} sends Done to Home`);
    assert.ok(/<BroadcastForm[\s\S]*?onDone=\{formDone\}/.test(app),
        `${appPath} sends BROADCAST Done through the Home callback`);
}

// --- 6. Copy-txid affordance is wired to the clipboard ------------------

// Copies go through the shared copyText helper, which owns the native
// plugin / browser split; the Done stage reports a failed copy in a toast.
assert.ok(/import \{ copyText \} from '\.\.\/clipboard\.js'/.test(send)
        && /await copyText\(txid\)/.test(send)
        && /Copy failed: clipboard unavailable/.test(send),
    'Done stage copy-txid goes through copyText and toasts a failed copy');

// --- 7. CSS additions ----------------------------------------------------

for (const cls of [
    'successCard',
    'successIcon',
    'successHint',
    'successSummary',
    'successRow',
    'successTxidBlock',
    'successTxidRow',
    'successLink',
]) {
    assert.ok(
        new RegExp(`\\.${cls}\\b`).test(css),
        `Send.module.css defines .${cls} for the §29.5 / G124 success layout`,
    );
}

console.log('broadcast-success smoke OK');
