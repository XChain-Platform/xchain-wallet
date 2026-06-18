// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §50 / Cluster L FOLLOWUP 3 smoke: diagnostic dump redaction sweep.
//
// Asserts:
//   1. Custom endpoint URLs (settings.sdkEndpoints[chainId]) are
//      replaced with `redacted:sha256:<hex>` rather than passed through
//      as-is. Built-in defaults remain unredacted.
//   2. The hash is stable across runs (same URL → same prefix) so the
//      same user's repeated dumps stay comparable, but the prefix is
//      short enough that the original is not recoverable.
//   3. AboutSection ships a "Show preview" expander and renders the
//      pretty-printed JSON before the user copies it.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { diagnosticDump } from '../../../packages/core/src/flows/diagnosticDump.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. Custom endpoint URLs are hashed ---------------------------------

const fakeRegistry = {
    supportedChains: () => [
        {
            id: 'BTC.mainnet',
            coin: 'BTC',
            networkKind: 'mainnet',
            isUserAdded: false,
            explorer: { defaultUrl: 'https://explorer.example', defaultPort: 443 },
            encoder: { defaultUrl: 'https://encoder.example', defaultPort: 443 },
            hub: { defaultUrl: 'https://hub.example', defaultPort: 443 },
        },
        {
            id: 'LTC.mainnet',
            coin: 'LTC',
            networkKind: 'mainnet',
            isUserAdded: false,
            explorer: { defaultUrl: 'https://ltc.example', defaultPort: 443 },
            encoder: { defaultUrl: 'https://ltc.example', defaultPort: 443 },
            hub: { defaultUrl: 'https://ltc.example', defaultPort: 443 },
        },
    ],
};

const customExplorer = 'https://my-private-node.example.lan:8332';
const fakeVault = {
    settings: {
        get: async () => ({
            sdkEndpoints: {
                'BTC.mainnet': {
                    explorerUrl: customExplorer,
                    encoderUrl: customExplorer,
                    hubUrl: customExplorer,
                    custom: true,
                },
            },
        }),
    },
    wallets: { count: async () => 0 },
    accounts: { count: async () => 0 },
    addresses: { count: async () => 0 },
    contacts: { count: async () => 0 },
    connectedSites: { count: async () => 0 },
    pendingTxs: { count: async () => 0 },
};

const dumpA = await diagnosticDump({ vault: fakeVault, chainRegistry: fakeRegistry });
const btc = dumpA.endpoints.find((e) => e.chainId === 'BTC.mainnet');
const ltc = dumpA.endpoints.find((e) => e.chainId === 'LTC.mainnet');

assert.ok(btc, 'BTC.mainnet endpoint row present in dump');
assert.equal(btc.custom, true, 'custom flag preserved on overridden chain');
assert.match(btc.explorerUrl, /^redacted:sha256:[0-9a-f]{8}$/,
    'custom explorerUrl replaced with redacted hash prefix');
assert.match(btc.encoderUrl, /^redacted:sha256:[0-9a-f]{8}$/,
    'custom encoderUrl replaced with redacted hash prefix');
assert.match(btc.hubUrl, /^redacted:sha256:[0-9a-f]{8}$/,
    'custom hubUrl replaced with redacted hash prefix');
assert.ok(!btc.explorerUrl.includes('my-private-node'),
    'redacted form does not leak the original hostname');

assert.equal(ltc.custom, false, 'unmodified chain keeps custom:false');
assert.equal(ltc.explorerUrl, 'https://ltc.example',
    'built-in default endpoint passes through verbatim');

// --- 2. Hash is stable across runs ----------------------------

const dumpB = await diagnosticDump({ vault: fakeVault, chainRegistry: fakeRegistry });
const btcB = dumpB.endpoints.find((e) => e.chainId === 'BTC.mainnet');
assert.equal(btc.explorerUrl, btcB.explorerUrl,
    'redaction is deterministic: same URL → same hash prefix across runs');

// --- 3. AboutSection has a "Show preview" expander ---------------------

const aboutSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'AboutSection.jsx'),
    'utf8',
);
assert.ok(/Show preview/.test(aboutSrc),
    'AboutSection ships a "Show preview" trigger label');
assert.ok(/Hide preview/.test(aboutSrc),
    'AboutSection toggles label to "Hide preview" while open');
assert.ok(/aria-controls="diagnostic-dump-preview"/.test(aboutSrc),
    'preview trigger associates with the preview region via aria-controls');
assert.ok(/id="diagnostic-dump-preview"/.test(aboutSrc),
    'preview region carries the matching id');
assert.ok(/aria-expanded=\{previewOpen\}/.test(aboutSrc),
    'preview trigger reports its expanded state for assistive tech');

// --- 4. diagnosticDump.js documents the redaction policy ---------------

const dumpSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'diagnosticDump.js'),
    'utf8',
);
assert.ok(/HASH \(Cluster L FOLLOWUP 3\)/.test(dumpSrc),
    'diagnosticDump header lists HASH category alongside NEVER / COUNT / INCLUDE');
assert.ok(/redactCustomUrl/.test(dumpSrc),
    'diagnosticDump exposes a redactCustomUrl helper for endpoint URLs');

console.log(
    'OK: diagnostic-dump-redaction smoke (§50 / Cluster L FOLLOWUP 3: custom endpoint URLs land as redacted:sha256:<hex>; AboutSection ships Show preview expander wired with aria-expanded + aria-controls; redaction is deterministic so a single user\'s dumps stay comparable)',
);
