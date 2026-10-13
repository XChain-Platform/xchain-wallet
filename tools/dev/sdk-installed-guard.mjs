#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isDevLink } from './sdk-link.mjs';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHELLS = ['web', 'extension', 'desktop'];
const SDK_RESOLUTION_PREFIX = '@dankest-llc/xchain-sdk@';

function yamlScalar(value) {
    const trimmed = value.trim();
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return trimmed.slice(1, -1).replaceAll("''", "'");
    }
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) return JSON.parse(trimmed);
    return trimmed;
}

function importerSdkResolution(lockfile, shell) {
    const lines = lockfile.split(/\r?\n/);
    const importer = `  packages/${shell}:`;
    const importerStart = lines.indexOf(importer);
    if (importerStart < 0) throw new Error(`lockfile has no ${shell} importer`);

    let sdkStart = -1;
    for (let index = importerStart + 1; index < lines.length; index += 1) {
        if (/^  \S/.test(lines[index])) break;
        if (lines[index] === '      xchain-sdk:') {
            sdkStart = index;
            break;
        }
    }
    if (sdkStart < 0) throw new Error(`lockfile ${shell} importer has no xchain-sdk entry`);

    for (let index = sdkStart + 1; index < lines.length; index += 1) {
        if (/^      \S/.test(lines[index])) break;
        const match = lines[index].match(/^        version:\s*(.+)$/);
        if (!match) continue;
        const resolution = yamlScalar(match[1]);
        if (!resolution.startsWith(SDK_RESOLUTION_PREFIX)) {
            throw new Error(`lockfile ${shell} xchain-sdk resolution is not the registry package`);
        }
        const version = resolution.slice(SDK_RESOLUTION_PREFIX.length);
        if (!version) throw new Error(`lockfile ${shell} xchain-sdk resolution has no version`);
        return version;
    }
    throw new Error(`lockfile ${shell} xchain-sdk entry has no resolved version`);
}

export function checkInstalledSdk(repoRoot = DEFAULT_REPO_ROOT) {
    const lockfilePath = path.join(repoRoot, 'pnpm-lock.yaml');
    const lockfile = readFileSync(lockfilePath, 'utf8');
    const results = [];

    for (const shell of SHELLS) {
        const expected = importerSdkResolution(lockfile, shell);
        const installedPath = path.join(repoRoot, 'packages', shell, 'node_modules', 'xchain-sdk');
        const packagePath = path.join(installedPath, 'package.json');
        if (isDevLink(installedPath) && existsSync(packagePath)) {
            results.push({ shell, status: 'dev-link', expected });
            continue;
        }
        if (!existsSync(packagePath)) {
            results.push({ shell, status: 'missing', expected });
            continue;
        }
        let actual;
        try {
            actual = JSON.parse(readFileSync(packagePath, 'utf8')).version;
        } catch (error) {
            results.push({ shell, status: 'invalid', expected, detail: error.message });
            continue;
        }
        results.push({
            shell,
            status: actual === expected ? 'match' : 'mismatch',
            expected,
            actual,
        });
    }
    return results;
}

export function main(argv = process.argv.slice(2)) {
    let repoRoot = DEFAULT_REPO_ROOT;
    if (argv.length) {
        if (argv.length !== 2 || argv[0] !== '--root' || !argv[1]) {
            console.error('usage: node tools/dev/sdk-installed-guard.mjs [--root <path>]');
            return 2;
        }
        repoRoot = path.resolve(argv[1]);
    }

    let results;
    try {
        results = checkInstalledSdk(repoRoot);
    } catch (error) {
        console.error(`sdk-installed-guard: ${error.message}`);
        return 1;
    }

    let failed = false;
    for (const result of results) {
        if (result.status === 'match') {
            console.log(`${result.shell}: xchain-sdk ${result.actual} matches the lockfile`);
        } else if (result.status === 'dev-link') {
            console.log(`${result.shell}: sdk:link development link exempt`);
        } else if (result.status === 'mismatch') {
            failed = true;
            console.error(`${result.shell}: installed xchain-sdk ${result.actual} does not match lockfile ${result.expected}`);
        } else if (result.status === 'missing') {
            failed = true;
            console.error(`${result.shell}: xchain-sdk is not installed (lockfile ${result.expected})`);
        } else {
            failed = true;
            console.error(`${result.shell}: cannot read installed xchain-sdk package.json: ${result.detail}`);
        }
    }
    return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = main();
}
