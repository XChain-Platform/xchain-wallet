// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §12 / Cluster S FOLLOWUP 1: sign-throttle settings UI.
//
// Pins:
//   - schemas/settings.js declares signThrottle?: { burst?, windowMs? }
//     with bounds constants + a v2-tolerant validator branch.
//   - flows/signThrottle.js accepts a `getLimits()` callback that's
//     called on every check() so settings updates take effect live.
//   - createBackgroundHost wires getLimits to a closure cache that's
//     hydrated on the first settings.get and refreshed on every
//     settings.update that touches signThrottle. The throttle is
//     passed into registerBridgeHandlers.
//   - ConnectedSitesSection mounts a SignThrottlePanel with burst +
//     window inputs, an Apply button, and live-effective copy.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const schemaSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'schemas', 'settings.js'),
    'utf8',
);
const flowSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'signThrottle.js'),
    'utf8',
);
const hostSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
const sectionSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'ConnectedSitesSection.jsx'),
    'utf8',
);
const panelSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'SignThrottlePanel.jsx'),
    'utf8',
);

// ─── 1. schema fields + bounds ──────────────────────────────────────────

assert.match(schemaSrc, /SIGN_THROTTLE_BURST_MIN = 1/, 'burst min constant');
assert.match(schemaSrc, /SIGN_THROTTLE_BURST_MAX = 1000/, 'burst max constant');
assert.match(schemaSrc, /SIGN_THROTTLE_WINDOW_MS_MIN = 1_000/, 'window min constant (1s)');
assert.match(schemaSrc, /SIGN_THROTTLE_WINDOW_MS_MAX = 24 \* 60 \* 60 \* 1000/, 'window max constant (24h)');
assert.match(schemaSrc, /\{\{ burst\?: number, windowMs\?: number \}\} \[signThrottle\]/,
    'typedef declares signThrottle as v2-tolerant');
assert.match(
    schemaSrc,
    /if \(r\.signThrottle !== undefined\)[\s\S]+?'signThrottle'/,
    'validator includes a signThrottle branch',
);
assert.match(
    schemaSrc,
    /r\.signThrottle\.burst === undefined[\s\S]+?>= SIGN_THROTTLE_BURST_MIN/,
    'validator allows undefined burst OR enforces bounds',
);
assert.match(
    schemaSrc,
    /r\.signThrottle\.windowMs === undefined[\s\S]+?>= SIGN_THROTTLE_WINDOW_MS_MIN/,
    'validator allows undefined windowMs OR enforces bounds',
);

// ─── 2. signThrottle accepts getLimits ──────────────────────────────────

assert.match(flowSrc, /opts\.getLimits/, 'createSignThrottle reads getLimits');
assert.match(
    flowSrc,
    /const getLimits = typeof opts\.getLimits === 'function'/,
    'createSignThrottle wraps getLimits with coercion',
);
assert.match(
    flowSrc,
    /const \{ burst, windowMs \} = getLimits\(\)/,
    'check() reads live limits via getLimits',
);
// Static back-compat: opts.burst / opts.windowMs without getLimits still work.
assert.match(flowSrc, /SIGN_THROTTLE_DEFAULT_BURST/, 'defaults still exported');

// ─── 3. createBackgroundHost wires throttle ────────────────────────────

const flowsImport = /const \{([\s\S]*?)\}\s*=\s*flows;/.exec(hostSrc);
assert.ok(flowsImport, 'host destructures its flow imports');
assert.match(flowsImport[1], /\bcreateSignThrottle\b/,
    'createSignThrottle imported from flows');
assert.match(hostSrc, /let cachedThrottleLimits =/,
    'host owns a cachedThrottleLimits closure variable');
assert.match(
    hostSrc,
    /async function refreshThrottleLimitsFromVault\(\)/,
    'host has an async refresh function',
);
assert.match(
    hostSrc,
    /const signThrottle = createSignThrottle\(\{[\s\S]+?getLimits:[\s\S]+?cachedThrottleLimits/,
    'host constructs the throttle with the cache-backed getLimits',
);
assert.match(
    hostSrc,
    /registerBridgeHandlers\([^;]*\bsignThrottle\b[^;]*\)/,
    'signThrottle is passed into registerBridgeHandlers',
);
assert.match(
    hostSrc,
    /Object\.prototype\.hasOwnProperty\.call\(patch, 'signThrottle'\)[\s\S]+?refreshThrottleLimitsFromVault/,
    'settings.update refreshes the cache when patch touches signThrottle',
);

// ─── 4. ConnectedSitesSection panel ────────────────────────────────────

assert.match(sectionSrc, /<SignThrottlePanel/,
    'SignThrottlePanel mounted as the Options view of ConnectedSitesSection');
assert.match(panelSrc, /export function SignThrottlePanel\(\)/,
    'SignThrottlePanel defined');
// The panel shows its own save error, so it mounts the hook with reportsOwnError
// and the hook adds no second message.
assert.match(panelSrc, /const \{ settings, update \} = useSettings\(\{ reportsOwnError: true \}\)/,
    'panel reads + writes settings via useSettings and reports its own error');
assert.match(panelSrc, /<Select\b/, 'the limit rows use the shared themed Select, never a native select');
assert.ok(!/<select\b/.test(panelSrc), 'no native select');
assert.match(panelSrc, /update\(\{ signThrottle: next \}\)/,
    'each choice writes the signThrottle pair via update, with no Save button');
assert.ok(!/type="submit"/.test(panelSrc), 'no submit button: choices apply at once');
assert.match(panelSrc, /messaging\.getSignThrottleStatus\(\)/,
    'the live per-site status is one host read');
// The smoke loader reads source with English copy in place of t() keys.
assert.match(panelSrc, /throttleInEffect|In effect now/, 'panel shows the In effect now card');

// ─── 5. the one bulk host read ──────────────────────────────────────────
assert.match(flowSrc, /function status\(\)/, 'throttle exposes a read-only status()');
assert.match(
    hostSrc,
    /host\.register\('sites\.throttleStatus', async \(\) => signThrottle\.status\(\)\)/,
    'host registers sites.throttleStatus returning signThrottle.status()',
);
for (const shim of [
    ['extension', 'src', 'popup', 'messaging.js'],
    ['web', 'src', 'messaging.js'],
    ['desktop', 'renderer', 'messaging.js'],
]) {
    const src = readFileSync(join(wsRoot, 'packages', ...shim), 'utf8');
    assert.match(src, /export function getSignThrottleStatus\(\)[\s\S]+?sendMessage\('sites\.throttleStatus'\)/,
        `${shim[0]} messaging exposes getSignThrottleStatus`);
}

console.log('sign-throttle-settings smoke OK');
