// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

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
