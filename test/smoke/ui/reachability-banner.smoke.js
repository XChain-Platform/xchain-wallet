// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §49.1 / §49.2 / G152 + G153 — reachability poll + banner.
// Cluster G Step 1 of 2.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');

// --- 1. useReachability hook ---------------------------------------------

const hookPath = join(core, 'src', 'shared', 'hooks', 'useReachability.js');
assert.ok(existsSync(hookPath), 'useReachability.js exists');
const hook = readFileSync(hookPath, 'utf8');
assert.ok(/export function useReachability\b/.test(hook),
    'useReachability is a named export');
assert.ok(/checkReachabilityRequest\(/.test(hook),
    'hook calls messaging.checkReachabilityRequest');
assert.ok(/setInterval/.test(hook),
    'hook polls on a setInterval');
assert.ok(/clearInterval/.test(hook),
    'hook clears its interval on unmount');
assert.ok(/cancelledRef/.test(hook),
    'hook tracks an unmount cancellation flag so late-arriving probes do not setState');

// --- 2. ReachabilityBanner component ------------------------------------

const bannerPath = join(core, 'src', 'shared', 'components', 'ReachabilityBanner.jsx');
const cssPath = join(core, 'src', 'shared', 'components', 'ReachabilityBanner.module.css');
assert.ok(existsSync(bannerPath), 'ReachabilityBanner.jsx exists');
assert.ok(existsSync(cssPath), 'ReachabilityBanner.module.css exists');
const banner = readFileSync(bannerPath, 'utf8');
assert.ok(/export function ReachabilityBanner\b/.test(banner),
    'ReachabilityBanner is a named export');
assert.ok(/useReachability/.test(banner),
    'ReachabilityBanner consumes useReachability');
// Must hide when overall is normal — otherwise normal users see a banner forever.
assert.ok(/overall !== ['"]degraded['"] && overall !== ['"]offline['"]/.test(banner),
    'ReachabilityBanner hides when overall is normal');
assert.ok(/role="status"/.test(banner),
    'ReachabilityBanner uses role="status" for screen readers');
assert.ok(/Retry/.test(banner),
    'ReachabilityBanner exposes a Retry button');

const css = readFileSync(cssPath, 'utf8');
assert.ok(/\.degraded\b/.test(css), 'CSS defines a .degraded variant');
assert.ok(/\.offline\b/.test(css), 'CSS defines an .offline variant');
assert.ok(/prefers-reduced-motion/.test(css),
    'CSS respects prefers-reduced-motion');

// --- 3. Background handler + messaging shims ----------------------------

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
assert.ok(/host\.register\(\s*['"]reachability\.check['"]/.test(bg),
    'background registers reachability.check handler');
assert.ok(/checkReachability,/.test(bg),
    'background pulls checkReachability off the flows namespace');

for (const file of [
    join(ext, 'src', 'popup', 'messaging.js'),
    join(web, 'src', 'messaging.js'),
]) {
    const src = readFileSync(file, 'utf8');
    assert.ok(/export function checkReachabilityRequest\b/.test(src),
        `${file.includes('extension') ? 'extension' : 'web'} messaging exports checkReachabilityRequest`);
    assert.ok(/sendMessage\(\s*['"]reachability\.check['"]/.test(src),
        `${file.includes('extension') ? 'extension' : 'web'} messaging routes to "reachability.check"`);
}

// --- 4. Both shells mount the banner above the route surface ------------

for (const [name, file] of [
    ['extension', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
]) {
    const src = readFileSync(file, 'utf8');
    assert.ok(/from ['"]@xchain-wallet\/core\/shared\/components\/ReachabilityBanner\.jsx['"]/.test(src),
        `${name} App imports ReachabilityBanner`);
    assert.ok(/<ReachabilityBanner\b/.test(src),
        `${name} App renders <ReachabilityBanner />`);
}

console.log('reachability-banner smoke OK');
