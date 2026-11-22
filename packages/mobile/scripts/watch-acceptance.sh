#!/usr/bin/env bash
# Copyright © 2025-2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$root"

pnpm test:unit
XCHAIN_NATIVE_SMOKES=1 pnpm test:smoke
pnpm test:tools
node tools/watch/gen-strings.mjs --check
node tools/watch/pending-watch-keys.mjs \
    "${XCHAIN_PENDING_WATCH_KEYS_SOURCE:-test/unit/i18n.test.js}"

run_xcode_suite() {
    local scheme="$1" destination="$2" suite="$3"
    xcodebuild test \
        -project packages/mobile/ios/App/App.xcodeproj \
        -scheme "$scheme" \
        -destination "platform=${destination}" \
        -only-testing:"$suite"
}

run_xcode_suite WatchApp 'watchOS Simulator,name=XC Watch 41mm' WatchAppTests
run_xcode_suite WatchApp 'watchOS Simulator,name=XC Watch 49mm' WatchAppTests
run_xcode_suite App 'iOS Simulator,name=XC iPhone 17' AppTests

bash packages/mobile/scripts/watch-test.sh gradle \
    :wear:testDebugUnitTest :app:testDebugUnitTest
npx playwright test --config test/e2e/playwright.config.js \
    test/e2e/tests/layout/shell-widths.spec.js \
    test/e2e/tests/layout/fold-transition.spec.js

XCHAIN_IOS_ARCHIVE_UNSIGNED=1 bash tools/release/ios-archive.sh
node tools/release/verify-ios-artifact.mjs \
    packages/mobile/ios/build/App.xcarchive/Products/Applications/App.app \
    --stage archive --unsigned
