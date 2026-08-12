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
//     those) and otherwise matches the request as a semver RANGE, which
//     is what ConnectOpts.requiredBridgeVersion is specified to be. The
//     helper used exact-string matching, so it refused every dApp that
//     wrote its requirement the documented way (). Pinned by
//     behaviour here, not by regex: a range matcher has cases.
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

// The RUNTIME values moved to runtime.js : the desktop MAIN process
// loads this package out of app.asar unbundled, and Node refuses to strip
// types from anything under node_modules, so a .ts-only entry point crashed
// the packaged app at startup. index.ts re-exports them and remains the
// public entry point; these assertions follow the definitions, and the
// type annotations they used to pin went with them.
// Both halves, because the package is split across them: runtime.js holds the
// values and index.ts holds the types. Reading the pair keeps every assertion
// below true of "the bridge spec source" without caring which file a given
// declaration ended up in.
const specSrc = [
    readFileSync(join(wsRoot, 'packages', 'bridge-spec', 'src', 'runtime.js'), 'utf8'),
    readFileSync(join(wsRoot, 'packages', 'bridge-spec', 'src', 'index.ts'), 'utf8'),
].join('\n');
const handlersSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'bridge', 'handlers.js'),
    'utf8',
);

// --- 1. bridge-spec exports -----------------------------------------------

assert.match(
    specSrc,
    /export const BRIDGE_SUPPORTED_VERSIONS = \['0\.1\.0'\]/,
    'BRIDGE_SUPPORTED_VERSIONS exported with current spec version',
);
assert.match(
    specSrc,
    /export function isBridgeVersionSupported\(requested\)/,
    'isBridgeVersionSupported helper exported',
);
assert.match(
    specSrc,
    /\| 'BRIDGE_VERSION_MISMATCH'/,
    'BridgeErrorCode union still includes BRIDGE_VERSION_MISMATCH',
);

// --- 2. handlers.js wiring ------------------------------------------------

assert.match(
    handlersSrc,
    /import \{[\s\S]+?BRIDGE_SPEC_VERSION,[\s\S]+?BRIDGE_SUPPORTED_VERSIONS,[\s\S]+?isBridgeVersionSupported,[\s\S]+?\} from '@xchain-wallet\/bridge-spec'/,
    'handlers imports the version-negotiation symbols',
);
// The handler must read the option name the spec publishes. Reading
// `req.bridgeVersion` meant a compliant dApp's requiredBridgeVersion arrived as
// undefined and negotiation was skipped for every one of them ().
assert.match(
    handlersSrc,
    /const requiredBridgeVersion = req\.requiredBridgeVersion \?\? req\.bridgeVersion;/,
    'connect reads the spec option name, with the legacy name as fallback',
);
assert.match(
    handlersSrc,
    /if \(!isBridgeVersionSupported\(requiredBridgeVersion\)\)[\s\S]+?bridgeError\(\s*'BRIDGE_VERSION_MISMATCH'/,
    'connect rejects with BRIDGE_VERSION_MISMATCH on unsupported version',
);
assert.doesNotMatch(
    handlersSrc,
    /isBridgeVersionSupported\(req\.bridgeVersion\)/,
    'the legacy-only version read is gone',
);
// connect's two return statements both include supportedVersions, and both
// report the WALLET's version: requiredBridgeVersion is a range, so echoing the
// request back would report a range where a version is declared.
const connectReturns = handlersSrc.match(/version: BRIDGE_SPEC_VERSION,\s*\n\s*supportedVersions:/g) || [];
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

// --- 3. isBridgeVersionSupported range behaviour --------------------------

const { isBridgeVersionSupported, BRIDGE_SUPPORTED_VERSIONS } =
    await import(join(wsRoot, 'packages', 'bridge-spec', 'src', 'runtime.js'));

assert.deepEqual(BRIDGE_SUPPORTED_VERSIONS, ['0.1.0'], 'one supported version today');
for (const pass of ['0.1.0', '^0.1.0', '~0.1.0', '>=0.1.0', '>0.0.9', '*', '^0.1.0 || ^1.0.0']) {
    assert.equal(isBridgeVersionSupported(pass), true, `${pass} is satisfied by 0.1.0`);
}
for (const fail of ['^1.2.0', '~0.2.0', '0.2.0', '>=0.2.0', '<0.1.0', 'not-a-range']) {
    assert.equal(isBridgeVersionSupported(fail), false, `${fail} is not satisfied by 0.1.0`);
}
// Unchanged pass-through: no requirement means no negotiation to fail.
for (const skip of ['', undefined, null, 42]) {
    assert.equal(isBridgeVersionSupported(skip), true, 'absent requirement passes through');
}

console.log('bridge-version-negotiation smoke OK');
