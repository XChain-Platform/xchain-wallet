// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isInvokedDirectly } from './is-invoked-directly.mjs';

const USAGE = `Usage: node tools/release/xcode-pin.mjs --help

Reads xcodebuild version output and the expected Xcode version and build pin.
Reports whether both toolchain values match without changing the toolchain pin.
`;

export function parseXcodebuildVersion(stdout) {
    if (typeof stdout !== 'string') return null;

    const match = /^Xcode[ \t]+(\S+)[ \t]*\r?\nBuild version[ \t]+(\S+)[ \t]*$/
        .exec(stdout.trim());
    if (!match) return null;

    return { version: match[1], build: match[2] };
}

export function checkXcodePin(stdout, pin) {
    const found = parseXcodebuildVersion(stdout);
    return {
        ok: found !== null && found.version === pin?.version && found.build === pin?.build,
        found,
    };
}

if (isInvokedDirectly(import.meta.url)
    && process.argv.length === 3
    && (process.argv[2] === '--help' || process.argv[2] === '-h')) {
    process.stdout.write(USAGE);
}
