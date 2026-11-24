// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path) => readFileSync(new URL(path, new URL('../../../', import.meta.url)), 'utf8');
const ceremony = read('tools/release/android-ceremony.sh');
const expected = read('tools/release/expected-artifacts.txt');
const lanes = read('tools/release/shipped-lanes.txt');

assert.match(ceremony, /\.\/gradlew --no-daemon clean bundleRelease/);
assert.match(
    ceremony,
    /RAW_WEAR_AAB="\$ANDROID_DIR\/wear\/build\/outputs\/bundle\/release\/wear-release\.aab"/,
);
assert.match(ceremony, /WEAR_AAB_NAME="xchain-wallet-wear-v\$\{ARTIFACT_VERSION\}\.aab"/);
assert.match(
    ceremony,
    /verify-wear-manifest\.mjs" \\\n+\s+"\$WORK_DIR\/wear-merged-manifest\.xml"/,
);

const wearVerify = ceremony.indexOf('verify-wear-manifest.mjs');
const phoneSign = ceremony.indexOf('sign_with_k9 "$WORK_DIR/$AAB_NAME"');
const wearSign = ceremony.indexOf('sign_with_k9 "$WORK_DIR/$WEAR_AAB_NAME"');
assert.ok(wearVerify > 0 && wearVerify < phoneSign);
assert.ok(phoneSign > 0 && phoneSign < wearSign);
assert.match(
    ceremony,
    /mv "\$WORK_DIR\/\$WEAR_AAB_NAME" "\$OUTPUT_DIR\/\$WEAR_AAB_NAME"/,
);
const stagedList = ceremony.slice(
    ceremony.indexOf('==> staged in'),
    ceremony.indexOf('==> K10 certificate fingerprint'),
);
assert.match(
    stagedList,
    /\$AAB_NAME   \(Play upload; NEVER hosted publicly\)"\necho "    \$WEAR_AAB_NAME   \(Play upload, Wear OS; NEVER hosted publicly\)/,
);
assert.match(ceremony, /sign all three artifacts/);
assert.match(ceremony, /sign all four artifacts/);
assert.doesNotMatch(ceremony, /both artifacts/);

const directApkLeg = ceremony.slice(
    ceremony.indexOf('# 3. Derive the universal APK'),
    ceremony.indexOf('# 3a. Record'),
);
assert.doesNotMatch(directApkLeg, /WEAR_AAB_NAME/);
assert.match(
    expected,
    /^optional\s+xchain-wallet-wear-v\*\.aab\s+store\s+-\s+deferred-android$/m,
);
assert.match(expected, /^#\s+wear[\s\S]{0,250}NEVER hosted publicly/im);
assert.match(
    lanes,
    /^android\s+SHIPPED\s+store-only\s+xchain-wallet-android-v\*\.aab\s+xchain-wallet-wear-v\*\.aab\s+xchain-wallet-v\*\[0-9\]\.apk$/m,
);
assert.match(
    lanes,
    /^android-full\s+SHIPPED\s+store-only\s+xchain-wallet-v\*-full\.apk$/m,
);

console.log(`android-ceremony-wear: 16 checks passed (${root})`);
