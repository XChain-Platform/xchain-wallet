// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALL_SCHEMES } from '../../../packages/desktop/main/protocol.js';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', '..', 'packages', 'desktop');
const requireCjs = createRequire(import.meta.url);
const config = requireCjs(join(desktop, 'electron-builder.config.cjs'));

function trueEntitlements(name) {
    const xml = readFileSync(join(desktop, 'build', name), 'utf8');
    return [...xml.matchAll(/<key>([^<]+)<\/key>\s*<true\/>/g)].map((match) => match[1]);
}

assert.equal(config.productName, 'XChain Wallet');
assert.equal(config.appId, 'io.xchain.wallet.desktop');
assert.equal(config.mac.hardenedRuntime, true);
assert.match(config.mac.extendInfo.NSCameraUsageDescription, /QR/i);

const scanner = readFileSync(join(desktop, '..', 'core', 'src', 'ui', 'QrScanner.jsx'), 'utf8');
assert.match(scanner, /getUserMedia\(\{\s*video:/s, 'QrScanner uses the video camera');
assert.deepEqual(trueEntitlements('entitlements.mac.plist'), [
    'com.apple.security.cs.allow-jit',
    'com.apple.security.device.camera',
]);
assert.ok(
    trueEntitlements('entitlements.mas.plist').includes('com.apple.security.device.camera'),
    'the sandboxed MAS build grants camera access',
);

for (const [platform, icon] of [
    ['mac', 'build/icon.icns'],
    ['win', 'build/icon.ico'],
    ['linux', 'build/icon.png'],
]) {
    assert.equal(config[platform].icon, icon);
    assert.ok(existsSync(join(desktop, icon)), `${platform} icon exists on disk`);
}

const packagedSchemes = config.protocols.flatMap(({ schemes }) => schemes).sort();
assert.deepEqual(packagedSchemes, [...ALL_SCHEMES].sort());

console.log('OK: desktop identity, icons, protocols, hardened runtime, and camera entitlements');
