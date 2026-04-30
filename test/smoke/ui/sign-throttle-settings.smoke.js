// Smoke for §12 / Cluster S FOLLOWUP 1 — sign-throttle settings UI.
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

assert.match(hostSrc, /createSignThrottle,?\s*\n?\s*\}\s*=\s*flows;/,
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
    /signThrottle\s*\}\s*\)/,
    'signThrottle is passed into registerBridgeHandlers',
);
assert.match(
    hostSrc,
    /Object\.prototype\.hasOwnProperty\.call\(patch, 'signThrottle'\)[\s\S]+?refreshThrottleLimitsFromVault/,
    'settings.update refreshes the cache when patch touches signThrottle',
);

// ─── 4. ConnectedSitesSection panel ────────────────────────────────────

assert.match(sectionSrc, /<SignThrottlePanel/,
    'SignThrottlePanel mounted at the bottom of ConnectedSitesSection');
assert.match(sectionSrc, /function SignThrottlePanel\(\)/,
    'SignThrottlePanel defined');
assert.match(sectionSrc, /const \{ settings, update \} = useSettings\(\)/,
    'panel reads + writes settings via useSettings');
assert.match(
    sectionSrc,
    /aria-label="Sign-throttle burst/,
    'burst input has an aria-label',
);
assert.match(
    sectionSrc,
    /aria-label="Sign-throttle window in seconds"/,
    'window input has an aria-label',
);
assert.match(
    sectionSrc,
    /update\(\{ signThrottle: patch \}\)/,
    'Apply patches signThrottle via update',
);
assert.match(
    sectionSrc,
    /Currently in effect:/,
    'panel shows the live-effective values',
);

console.log('sign-throttle-settings smoke OK');
