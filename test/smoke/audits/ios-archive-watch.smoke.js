// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const archive = readFileSync(join(root, 'tools/release/ios-archive.sh'), 'utf8');
const exportScript = readFileSync(join(root, 'tools/release/ios-export.sh'), 'utf8');
const watchGate = 'tools/release/watch-embed.mjs';

assert.match(archive, /'CODE_SIGN_ENTITLEMENTS\[sdk=iphoneos\*\] ='/,
    'unsigned archives must clear entitlements only for the iOS App target');
assert.doesNotMatch(archive, /^\s*CODE_SIGN_ENTITLEMENTS=""/m,
    'unsigned archives must not clear watch target entitlements globally');
assert.match(archive, /-xcconfig "\$unsigned_config"/,
    'the unsigned archive must supply its scoped setting as an xcconfig');
assert.equal(archive.split(watchGate).length - 1, 1,
    'archive creation must check its embedded watch app and widget once');
assert.ok(archive.includes(`if ! node "$here/${watchGate}" "$archive"; then`),
    'the archive watch check must refuse a missing embed');
assert.ok(archive.indexOf(watchGate) > archive.indexOf('xcodebuild archive')
    && archive.indexOf(watchGate) < archive.indexOf('ios-archive: wrote'),
    'the archive watch gate must run after the build and before success');

assert.equal(exportScript.split(watchGate).length - 1, 2,
    'export must check the source archive and the exported IPA');
assert.ok(exportScript.includes(`if ! node "$here/${watchGate}" "$archive"; then`),
    'export must refuse a source archive with a missing embed');
assert.ok(exportScript.includes(`if ! node "$here/${watchGate}" "$target" ||`),
    'export must reject an IPA with a missing embed');
const firstGate = exportScript.indexOf(watchGate);
const secondGate = exportScript.indexOf(watchGate, firstGate + watchGate.length);
assert.ok(firstGate < exportScript.indexOf('xcodebuild -exportArchive'),
    'the archive watch gate must run before export');
assert.ok(secondGate > exportScript.indexOf('mv "$exported" "$target"')
    && secondGate < exportScript.indexOf('ios-export: wrote'),
    'the IPA watch gate must run after naming and before success');

console.log('ios archive watch audit passed: 11 checks');
