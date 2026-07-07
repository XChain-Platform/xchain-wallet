#!/usr/bin/env node
// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sync the wallet's bundled chain descriptors (the authoritative UX/endpoint
// metadata per chain, packages/core/src/registry/descriptors/) into the hub's
// served chain-registry snapshot (xchain-hub/src/chain-registry.json, the
// GET /api/v1/chain-registry payload). Same canonical->vendored pattern as
// xchain-hub/bin/sync-coins.sh, with JSON as the wire shape: the hub must not
// grow its own copy of wallet UX metadata, and the wallet must not fetch a
// registry that disagrees with what it ships.
//
// The snapshot is only rewritten when the descriptors actually change, so
// generated_at stays stable and --check can byte-compare descriptor content.
//
// Usage:
//   node bin/sync-chain-registry.mjs           Write/refresh the hub snapshot.
//   node bin/sync-chain-registry.mjs --check   Exit 1 if the snapshot has drifted.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { BUNDLED_DESCRIPTORS } from '../packages/core/src/registry/descriptors/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT  = path.resolve(HERE, '../../xchain-hub/src/chain-registry.json');

const CHECK = process.argv.includes('--check');
const SCHEMA_VERSION = 1;

const nextDescriptors = JSON.parse(JSON.stringify(BUNDLED_DESCRIPTORS));
const nextJson = (generatedAt) => JSON.stringify({
    schema_version: SCHEMA_VERSION,
    generated_at:   generatedAt,
    descriptors:    nextDescriptors
}, null, 2) + '\n';

let current = null;
if (existsSync(OUT)) {
    try { current = JSON.parse(readFileSync(OUT, 'utf8')); } catch (e) { current = null; }
}
const inSync = current &&
    current.schema_version === SCHEMA_VERSION &&
    JSON.stringify(current.descriptors) === JSON.stringify(nextDescriptors);

if (CHECK) {
    if (inSync) {
        console.log('OK: xchain-hub/src/chain-registry.json matches the wallet bundled descriptors.');
        process.exit(0);
    }
    console.error('DRIFT: xchain-hub/src/chain-registry.json does not match the wallet bundled '
        + 'descriptors; run xchain-wallet/bin/sync-chain-registry.mjs to resync.');
    process.exit(1);
}

if (inSync) {
    console.log('chain-registry snapshot already in sync (' + nextDescriptors.length + ' descriptors); not rewritten.');
    process.exit(0);
}
writeFileSync(OUT, nextJson(new Date().toISOString()));
console.log('wrote ' + OUT + ': ' + nextDescriptors.length + ' descriptors (schema_version ' + SCHEMA_VERSION + ')');
