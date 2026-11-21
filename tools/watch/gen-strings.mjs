// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

function sortedEntries(map) {
    return Object.keys(map).sort().map((key) => [key, map[key]]);
}

function escapeApple(value) {
    return value
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')
        .replace(/\r\n?|\n/g, '\\n');
}

function androidName(key) {
    const name = key.replace(/[.-]/g, '_');
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
        throw new Error(`Invalid Android resource name: ${key}`);
    }
    return name;
}

function escapeAndroid(value) {
    const escaped = value
        .replaceAll('\\', '\\\\')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll("'", "\\'")
        .replaceAll('"', '\\"')
        .replace(/\r\n?|\n/g, '\\n');

    return /^[?@]/.test(escaped) ? `\\${escaped}` : escaped;
}

export function toAppleStrings(map) {
    const lines = sortedEntries(map).map(([key, value]) => (
        `"${escapeApple(key)}" = "${escapeApple(value)}";`
    ));
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

export function toAndroidStringsXml(map) {
    const names = new Set();
    const lines = sortedEntries(map).map(([key, value]) => {
        const name = androidName(key);
        if (names.has(name)) {
            throw new Error(`Duplicate Android resource name: ${name}`);
        }
        names.add(name);
        const formatted = value.includes('%') ? ' formatted="false"' : '';
        return `    <string name="${name}"${formatted}>${escapeAndroid(value)}</string>`;
    });

    return [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<resources>',
        ...lines,
        '</resources>',
        '',
    ].join('\n');
}
