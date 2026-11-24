// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const sourcePaths = [
    'packages/core/src/watch/contract/strings-alerts.json',
    'packages/core/src/watch/contract/strings-balances.json',
    'packages/core/src/watch/contract/strings-surfaces.json',
];
const outputs = [
    ['packages/mobile/ios/App/WatchApp/en.lproj/Localizable.strings', toAppleStrings],
    ['packages/mobile/ios/App/WatchWidgets/en.lproj/Localizable.strings', toAppleStrings],
    ['packages/mobile/android/wear/src/main/res/values/strings.xml', (strings) => (
        toAndroidStringsXml(Object.fromEntries(sortedEntries(strings).map(([key, value]) => [
            key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
            value,
        ])))
    )],
];

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

async function loadStrings(base) {
    const maps = await Promise.all(sourcePaths.map(async (name) => (
        JSON.parse(await readFile(path.join(base, name), 'utf8'))
    )));
    return Object.assign({}, ...maps);
}

export async function generateStrings(base, check = false) {
    const strings = await loadStrings(base);
    const generated = outputs.map(([name, emit]) => [name, emit(strings)]);

    if (check) {
        const stale = [];
        for (const [name, expected] of generated) {
            const actual = await readFile(path.join(base, name), 'utf8').catch(() => null);
            if (actual !== expected) stale.push(name);
        }
        if (stale.length) throw new Error(`Stale generated strings: ${stale.join(', ')}`);
        return;
    }

    await Promise.all(generated.map(async ([name, content]) => {
        const destination = path.join(base, name);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, content);
    }));
}

const isMain = process.argv[1]
    && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isMain) {
    generateStrings(root, process.argv.includes('--check')).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
