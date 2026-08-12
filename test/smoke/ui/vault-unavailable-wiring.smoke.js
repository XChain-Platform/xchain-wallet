// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The vault-unavailable screen is wired in ALL THREE shells.
//
// The component and its behaviour are covered by
// test/unit/routes/VaultUnavailable.test.jsx. This guards the other half,
// which no unit test can see: three App.jsx files that each catch the boot
// failure and each decide what to render. A screen wired into one of three
// shells is not a fixed bug, it is a bug with a smaller blast radius, and
// nothing about a green unit suite would say so.
//
// It also pins the ORDER of the two steps. The shells keep only
// `err?.message` from the boot failure, so if `vaultErrorKind` is not called
// at the catch, the type is gone by the time anything renders and every vault
// failure falls back to the generic red-text screen - which looks exactly
// like this was never built.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const wsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

const SHELLS = [
    ['web', ['packages', 'web', 'src', 'App.jsx']],
    ['desktop', ['packages', 'desktop', 'renderer', 'App.jsx']],
    ['extension', ['packages', 'extension', 'src', 'popup', 'App.jsx']],
];

for (const [name, path] of SHELLS) {
    const src = read(...path);

    assert.match(
        src,
        /import \{ VaultUnavailable \} from '@xchain-wallet\/core\/shared\/routes\/VaultUnavailable\.jsx'/,
        `${name}: must import the shared screen rather than growing its own`,
    );

    assert.match(
        src,
        /errorKind: coreStorageLib\.vaultErrorKind\(err\)/,
        `${name}: must narrow the error AT THE CATCH; the shells keep only`
        + ' err.message, so the type is unrecoverable one line later',
    );

    assert.match(
        src,
        /status\.errorKind[\s\S]{0,120}?<VaultUnavailable kind=\{status\.errorKind\}/,
        `${name}: must render VaultUnavailable when the boot failure was a vault one`,
    );

    // The generic path has to survive: a network error at boot is not a vault
    // error and must not claim to be one.
    assert.match(
        src,
        /: <Loading error=\{status\.error\} \/>/,
        `${name}: a non-vault boot error still falls back to the generic screen`,
    );
}

// The classifier has to be exported from the storage barrel the shells import,
// not just from the module that defines it.
const storageIndex = read('packages', 'core', 'src', 'storage', 'index.js');
assert.match(
    storageIndex,
    /vaultErrorKind,/,
    'vaultErrorKind must be exported from core/storage/index.js: the shells reach'
    + ' it through the `storage` barrel, not through backend.js directly',
);

// The destructive escape is offered for exactly one kind. Asserted here as
// well as in the unit test because this is the property whose regression is
// worst: an erase button on a LOCKED vault destroys a wallet that was never
// damaged, to fix a device the user had simply not unlocked.
const screenSrc = read('packages', 'core', 'src', 'shared', 'routes', 'VaultUnavailable.jsx');
assert.match(
    screenSrc,
    /kind === 'corrupt' && !wipeOpen/,
    'the escape link is gated on corrupt alone',
);
assert.match(
    screenSrc,
    /kind === 'corrupt' && wipeOpen/,
    'the wipe panel is gated on corrupt alone',
);
assert.match(
    screenSrc,
    /confirmText\.trim\(\)\.toUpperCase\(\) !== 'WIPE'/,
    'the wipe stays behind the same type-WIPE gate the Locked screen uses',
);

console.log(
    'OK: vault-unavailable wiring smoke (all three shells narrow the boot'
    + ' failure with vaultErrorKind at the catch and render the shared'
    + ' VaultUnavailable screen, non-vault errors still fall back to Loading,'
    + ' vaultErrorKind is exported from the storage barrel, and the destructive'
    + ' escape is gated on corrupt alone behind the type-WIPE confirmation)',
);
