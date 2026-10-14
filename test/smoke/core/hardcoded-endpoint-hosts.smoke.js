// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
    ANDROID_UPDATE_FEED_URL,
    ARWEAVE_GATEWAY_BASE,
    COINGECKO_API_BASE,
    DEFAULT_EXPLORER_BASE,
    DEFAULT_HUB_BASE,
    DEFAULT_MINER_URL,
    EXTERNAL_EXPLORERS,
    IPFS_GATEWAY_BASE,
    LOCAL_CONNECT_SOURCES,
    TREZOR_CONNECT_ORIGIN,
} from '../../../packages/core/src/branding/branding.js';

const CONFIG_PATH = 'packages/core/src/branding/branding.js';
const CONFIG_PREFIXES = [
    CONFIG_PATH,
    'packages/core/src/registry/',
    'packages/core/src/shared/platform-links.json',
];
const configuredUrls = [
    ANDROID_UPDATE_FEED_URL,
    ARWEAVE_GATEWAY_BASE,
    COINGECKO_API_BASE,
    DEFAULT_EXPLORER_BASE,
    DEFAULT_HUB_BASE,
    DEFAULT_MINER_URL,
    IPFS_GATEWAY_BASE,
    TREZOR_CONNECT_ORIGIN,
    ...LOCAL_CONNECT_SOURCES,
    ...Object.values(EXTERNAL_EXPLORERS)
        .flatMap(({ baseUrl, iconUrl }) => [baseUrl, iconUrl]),
];
const endpointHosts = new Set(configuredUrls.map((value) => {
    const match = /^[a-z]+:\/\/([^/:*]+)/i.exec(value);
    assert.ok(match, `configured endpoint has an absolute URL shape: ${value}`);
    return match[1].toLowerCase();
}));
endpointHosts.delete('localhost');
endpointHosts.delete('127.0.0.1');
const files = execFileSync('git', [
    'ls-files',
    ':(glob)packages/core/src/shared/**',
    ':(glob)packages/*/src/**',
], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const urlHostPattern = /https?:\/\/([a-z0-9.-]+)/gi;
const violations = [];

for (const file of files) {
    if (CONFIG_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
    if (/(?:^|\/)(?:test|androidTest|__tests__)(?:\/|$)/.test(file)) continue;
    if (/demo/i.test(file)) continue;
    let source = readFileSync(file, 'utf8');
    if (file === 'packages/core/src/flows/tokenInfo.js') {
        source = source.split('\nfunction demoRowFor(', 1)[0];
    }
    for (const [index, line] of source.split('\n').entries()) {
        if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) continue;
        for (const match of line.matchAll(urlHostPattern)) {
            if (!endpointHosts.has(match[1].toLowerCase())) continue;
            violations.push(`${file}:${index + 1}: ${match[0]}`);
        }
    }
}

assert.deepEqual(
    violations,
    [],
    `runtime endpoint URLs must come from ${CONFIG_PATH}:\n${violations.join('\n')}`,
);
assert.ok(endpointHosts.size >= 10, 'the smoke must cover the configured endpoint host set');

console.log(`OK: hard-coded endpoint host smoke (${files.length} source files, ${endpointHosts.size} hosts)`);
