// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §43 / Cluster F FOLLOWUP 3: bridge version negotiation.
//
// Pins:
//   - bridge-spec exports BRIDGE_SUPPORTED_VERSIONS + isBridgeVersion-
//     Supported helper.
//   - isBridgeVersionSupported accepts empty / non-string requests
//     (the connect handler falls through to BRIDGE_SPEC_VERSION for
//     those) and returns true only for exact-match supported versions.
//   - The BRIDGE_VERSION_MISMATCH error code is declared in the
//     BridgeErrorCode union.
//   - bridge/handlers.js calls isBridgeVersionSupported in bridge.connect
//     and rejects with BRIDGE_VERSION_MISMATCH on mismatch.
//   - connect's return shape now carries `supportedVersions` so a dApp
//     can pre-detect via provider.version + supportedVersions before
//     attempting any version-specific method.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const specSrc = readFileSync(
    join(wsRoot, 'packages', 'bridge-spec', 'src', 'index.ts'),
    'utf8',
);
const handlersSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'bridge', 'handlers.js'),
    'utf8',
);

// ─── 1. bridge-spec exports ────────────────────────────────────────────

assert.match(
    specSrc,
    /export const BRIDGE_SUPPORTED_VERSIONS: readonly string\[\] = \['0\.1\.0'\]/,
    'BRIDGE_SUPPORTED_VERSIONS exported with current spec version',
);
assert.match(
    specSrc,
    /export function isBridgeVersionSupported\(requested: unknown\): boolean/,
    'isBridgeVersionSupported helper exported',
);
assert.match(
    specSrc,
    /BRIDGE_SUPPORTED_VERSIONS\.includes\(requested\)/,
    'isBridgeVersionSupported delegates to .includes',
);
assert.match(
    specSrc,
    /\| 'BRIDGE_VERSION_MISMATCH'/,
    'BridgeErrorCode union still includes BRIDGE_VERSION_MISMATCH',
);

// ─── 2. handlers.js wiring ─────────────────────────────────────────────

assert.match(
    handlersSrc,
    /import \{[\s\S]+?BRIDGE_SPEC_VERSION,[\s\S]+?BRIDGE_SUPPORTED_VERSIONS,[\s\S]+?isBridgeVersionSupported,[\s\S]+?\} from '@xchain-wallet\/bridge-spec'/,
    'handlers imports the version-negotiation symbols',
);
assert.match(
    handlersSrc,
    /if \(!isBridgeVersionSupported\(req\.bridgeVersion\)\)[\s\S]+?bridgeError\(\s*'BRIDGE_VERSION_MISMATCH'/,
    'connect rejects with BRIDGE_VERSION_MISMATCH on unsupported version',
);
// connect's two return statements both include supportedVersions now.
const connectReturns = handlersSrc.match(/return \{\s*\n\s*version: req\.bridgeVersion \?\? BRIDGE_SPEC_VERSION,\s*\n\s*supportedVersions:/g) || [];
assert.equal(
    connectReturns.length, 2,
    'both connect return paths (existing + new) carry supportedVersions',
);
// Old hardcoded '0.1.0' literal in version field should be gone.
assert.doesNotMatch(
    handlersSrc,
    /version: req\.bridgeVersion \?\? '0\.1\.0'/,
    'hardcoded "0.1.0" version literal replaced with BRIDGE_SPEC_VERSION constant',
);

console.log('bridge-version-negotiation smoke OK');
