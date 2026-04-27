// Smoke for §37 / §29 / G124 — Send.jsx broadcast success confirmation.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const sendJsx = join(core, 'src', 'shared', 'routes', 'Send.jsx');
const sendCss = join(core, 'src', 'shared', 'routes', 'Send.module.css');

assert.ok(existsSync(sendJsx), 'Send.jsx exists');
const send = readFileSync(sendJsx, 'utf8');
const css = readFileSync(sendCss, 'utf8');

// --- 1. Done stage renders the new success card ---------------------------

assert.ok(/stage === 'done'/.test(send), 'Send still gates on stage === "done"');
assert.ok(/className=\{styles\.successCard\}/.test(send),
    'Done stage renders the styles.successCard wrapper');
assert.ok(/Broadcast — pending/.test(send),
    'Done stage uses "Broadcast — pending" copy (§28.4 status timeline language)');
assert.ok(/role="status"\s+aria-live="polite"/.test(send),
    'Done stage announces success via role=status + aria-live=polite');

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

// --- 4. Copy-txid affordance is wired to the clipboard ------------------

assert.ok(/navigator\.clipboard\?\.writeText/.test(send),
    'Done stage copy-txid uses navigator.clipboard.writeText (best-effort guarded)');

// --- 5. CSS additions ----------------------------------------------------

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
