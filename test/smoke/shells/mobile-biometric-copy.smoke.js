// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The biometric reason vocabulary, across three languages.
//
// The shared settings row no longer composes its own explanation of why
// biometric unlock is unavailable; the device does, via a stable `reasonCode`
// that the shared JS maps to plain language. That contract spans Java, Swift
// and JavaScript, which means nothing in any one of them can see it break.
// The failure would be silent and cosmetic-looking: a native half emits a
// token the JS has never heard of, the map misses, and the user gets the
// generic sentence back - exactly the uninformative copy this item removed.
//
// So this smoke reads all three files and checks they agree on the tokens.
// It also pins the rule that made the item necessary: the native `detail`
// string is for logs and is never what a user reads.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const androidVault = join(
    wsRoot, 'packages', 'mobile', 'android', 'app', 'src', 'main',
    'java', 'io', 'xchain', 'wallet', 'android', 'vault',
);
const iosVault = join(wsRoot, 'packages', 'mobile', 'ios', 'App', 'App', 'vault');

const sidecarJava = readFileSync(join(androidVault, 'VaultBiometricSidecar.java'), 'utf8');
const pluginJava = readFileSync(join(androidVault, 'XChainVaultPlugin.java'), 'utf8');
const sidecarSwift = readFileSync(join(iosVault, 'VaultBiometricSidecar.swift'), 'utf8');
const pluginSwift = readFileSync(join(iosVault, 'XChainVaultPlugin.swift'), 'utf8');
const providerJs = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'storage', 'nativeBiometricProvider.js'), 'utf8',
);

// --- both plugins put the two new fields on the wire ---------------------

for (const [label, src, put] of [
    ['Android', pluginJava, (f) => new RegExp(`reply\\.put\\("${f}"`)],
    ['iOS', pluginSwift, (f) => new RegExp(`"${f}":`)],
]) {
    for (const field of ['reasonCode', 'mechanism']) {
        assert.match(src, put(field), `${label} biometricStatus returns ${field}`);
    }
}

// --- the token vocabulary, extracted rather than restated ----------------

function tokensFrom(source, pattern) {
    const found = new Set();
    for (const match of source.matchAll(pattern)) found.add(match[1]);
    found.delete('ok'); // "ok" is the absence of a reason, not a reason.
    return found;
}

const androidTokens = tokensFrom(sidecarJava, /reasonCode = "([a-z_]+)"/g);

// Swift's mapper is one function; read only its body so the mechanism
// strings below it ("Face ID") cannot be mistaken for reason tokens.
const swiftMapper = sidecarSwift.match(
    /func reasonCode\(for error: NSError\?\) -> String \{[\s\S]*?\n {4}\}/,
);
assert.ok(swiftMapper, 'iOS sidecar has a reasonCode mapper to read');
const iosTokens = tokensFrom(swiftMapper[0], /return "([a-z_]+)"/g);

const reasonsBlock = providerJs.match(/const REASONS = Object\.freeze\(\{[\s\S]*?\n\}\);/);
assert.ok(reasonsBlock, 'the shared provider has a REASONS table to read');
const jsTokens = tokensFrom(reasonsBlock[0], /^\s{4}([a-z_]+):/gm);

assert.ok(androidTokens.size >= 4, `Android emits a real spread of codes (${androidTokens.size})`);
assert.ok(iosTokens.size >= 3, `iOS emits a real spread of codes (${iosTokens.size})`);

for (const [label, tokens] of [['Android', androidTokens], ['iOS', iosTokens]]) {
    for (const token of tokens) {
        assert.ok(
            jsTokens.has(token),
            `${label} can emit reasonCode "${token}" and the shared REASONS table has no entry`
            + ' for it, so that device would silently fall back to generic copy',
        );
    }
}

// --- the developer string stays a developer string -----------------------

const describeBody = providerJs.match(/async describe\(\) \{[\s\S]*?\n {4}\},/);
assert.ok(describeBody, 'the native provider has a describe() to read');
assert.doesNotMatch(
    describeBody[0],
    /\bdetail\b/,
    'describe() must not read the native `detail`: it is a developer string'
    + ' ("no biometric enrolled", an NSError description) and is never user copy',
);
assert.match(
    describeBody[0],
    /REASONS\[reply\?\.reasonCode\]/,
    'the user-facing reason is looked up from the shared table, not passed through',
);

// --- Android reports what its sensors are, rather than guessing ----------

assert.match(
    sidecarJava,
    /hasSystemFeature\("android\.hardware\.fingerprint"\)/,
    'Android derives its mechanism wording from the sensors the device declares',
);
assert.match(
    sidecarSwift,
    /case \.faceID[\s\S]{0,80}return "Face ID"/,
    'iOS names Face ID because LocalAuthentication told it so, not because a'
    + ' shared component guessed',
);

console.log('mobile-biometric-copy smoke OK');
