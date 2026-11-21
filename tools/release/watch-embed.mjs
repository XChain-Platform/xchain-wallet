// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawnSync } from 'node:child_process';
import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { isInvokedDirectly } from './is-invoked-directly.mjs';

const REQUIRED_EMBEDS = [
    'Watch/WatchApp.app/Info.plist',
    'Watch/WatchApp.app/PlugIns/WatchWidgets.appex/Info.plist',
];

const USAGE = `Usage: node tools/release/watch-embed.mjs <archive.xcarchive|app.ipa>

Checks that the Apple Watch app and its widget extension are embedded.

Exits 0 when both are present, 1 when an embed is missing, and 2 when the
input cannot be read.
`;

function normalizeEntry(entry) {
    return String(entry).replace(/\/+$/, '');
}

export function missingWatchEmbeds(entries, appRoot) {
    const root = normalizeEntry(appRoot);
    const listed = new Set(entries.map(normalizeEntry));
    return REQUIRED_EMBEDS.filter((entry) => !listed.has(root ? `${root}/${entry}` : entry));
}

function archiveEntries(archivePath, appRoot) {
    const root = join(archivePath, ...appRoot.split('/'));
    const entries = [];
    const walk = (directory, relative = '') => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
            entries.push(`${appRoot}/${childRelative}${entry.isDirectory() ? '/' : ''}`);
            if (entry.isDirectory()) walk(join(directory, entry.name), childRelative);
        }
    };
    try {
        walk(root);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    return entries;
}

function ipaEntries(ipaPath) {
    const result = spawnSync('unzip', ['-Z1', ipaPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error((result.stderr || 'unzip could not list the IPA').trim());
    return result.stdout.split(/\r?\n/).filter(Boolean);
}

function run(argv) {
    if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
        process.stdout.write(USAGE);
        return 0;
    }
    if (argv.length !== 1) {
        process.stderr.write(USAGE);
        return 2;
    }

    const input = argv[0];
    let entries;
    let appRoot;
    try {
        accessSync(input, constants.R_OK);
        const info = statSync(input);
        if (input.endsWith('.xcarchive') && info.isDirectory()) {
            appRoot = 'Products/Applications/App.app';
            entries = archiveEntries(input, appRoot);
        } else if (input.endsWith('.ipa') && info.isFile()) {
            appRoot = 'Payload/App.app';
            entries = ipaEntries(input);
        } else {
            throw new Error('expected an .xcarchive directory or .ipa file');
        }
    } catch (error) {
        process.stderr.write(`watch-embed: cannot read ${input}: ${error.message}\n`);
        return 2;
    }

    const missing = missingWatchEmbeds(entries, appRoot);
    if (missing.length > 0) process.stdout.write(`${missing.join('\n')}\n`);
    return missing.length > 0 ? 1 : 0;
}

if (isInvokedDirectly(import.meta.url)) process.exitCode = run(process.argv.slice(2));
