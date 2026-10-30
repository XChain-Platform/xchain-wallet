#!/usr/bin/env node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    marketingVersionFromTag,
    versionCodeFromTag,
    versionNameFromTag,
} from '../packages/mobile/scripts/version.js';

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readJson(root, path) {
    return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function propertyValue(contents, name) {
    return contents.match(new RegExp(`^${name}\\s*=\\s*(\\S+)\\s*$`, 'm'))?.[1];
}

function directBuildSettings(contents, name) {
    return [...contents.matchAll(new RegExp(`^\\s*${name}\\s*=\\s*([^;]+);`, 'gm'))]
        .map((match) => match[1].trim());
}

function generatedValue(root, path, name) {
    if (!existsSync(join(root, path))) return null;
    return propertyValue(readFileSync(join(root, path), 'utf8'), name);
}

function packageJsonFiles(root, directory = 'packages') {
    return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules') {
            return packageJsonFiles(root, path);
        }
        return entry.isFile() && entry.name === 'package.json' ? [path] : [];
    });
}

export function inspectBuildPreflight(root = SCRIPT_ROOT) {
    const fixtureRoot = resolve(root);
    const rootVersion = readJson(fixtureRoot, 'package.json').version;
    const versionCode = String(versionCodeFromTag(rootVersion));
    const versionName = versionNameFromTag(rootVersion);
    const marketingVersion = marketingVersionFromTag(rootVersion);
    const checks = [];

    const check = (label, inspect) => {
        try {
            checks.push({ label, ok: true, detail: inspect() });
        } catch (error) {
            checks.push({ label, ok: false, detail: error.message });
        }
    };
    const requireEqual = (actual, expected, description) => {
        if (actual !== expected) {
            throw new Error(`${description} is ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`);
        }
    };

    check('package versions', () => {
        const packageFiles = packageJsonFiles(fixtureRoot).sort();
        if (packageFiles.length === 0) throw new Error('no package.json files found below packages/');
        const drifted = packageFiles.flatMap((path) => {
            const actual = readJson(fixtureRoot, path).version;
            return actual === rootVersion ? [] : [`${path}=${String(actual)}`];
        });
        if (drifted.length > 0) {
            throw new Error(`expected ${rootVersion}; mismatches: ${drifted.join(', ')}`);
        }
        return `${packageFiles.length} packages match ${rootVersion}`;
    });

    const androidGradlePath = 'packages/mobile/android/app/build.gradle';
    const androidPropertiesPath = 'packages/mobile/android/version.properties';

    check('Android versionCode', () => {
        const androidGradle = readFileSync(join(fixtureRoot, androidGradlePath), 'utf8');
        const direct = androidGradle.match(/^\s*versionCode\s+(\d+)\s*$/m)?.[1];
        const wired = /versionCode\s+versionProps\[['"]versionCode['"]\](?:\.toInteger\(\))?/.test(androidGradle);
        if (direct !== undefined) requireEqual(direct, versionCode, 'Gradle versionCode');
        else if (!wired) throw new Error('Gradle does not read versionCode from version.properties');
        const generated = generatedValue(fixtureRoot, androidPropertiesPath, 'versionCode');
        if (generated !== null) requireEqual(generated, versionCode, 'generated versionCode');
        return `${versionCode} matches ${rootVersion}`;
    });

    check('Android versionName', () => {
        const androidGradle = readFileSync(join(fixtureRoot, androidGradlePath), 'utf8');
        const direct = androidGradle.match(/^\s*versionName\s+["']([^"']+)["']\s*$/m)?.[1];
        const wired = /versionName\s+versionProps\[['"]versionName['"]\]/.test(androidGradle);
        if (direct !== undefined) requireEqual(direct, versionName, 'Gradle versionName');
        else if (!wired) throw new Error('Gradle does not read versionName from version.properties');
        const generated = generatedValue(fixtureRoot, androidPropertiesPath, 'versionName');
        if (generated !== null) requireEqual(generated, versionName, 'generated versionName');
        return `${versionName} matches ${rootVersion}`;
    });

    const iosProjectPath = 'packages/mobile/ios/App/App.xcodeproj/project.pbxproj';
    const iosConfigPath = 'packages/mobile/ios/App/Version.xcconfig';

    check('iOS MARKETING_VERSION', () => {
        const iosProject = readFileSync(join(fixtureRoot, iosProjectPath), 'utf8');
        const usesVersionConfig = /baseConfigurationReference\s*=\s*\w+\s*\/\* Version\.xcconfig \*\//
            .test(iosProject);
        const direct = directBuildSettings(iosProject, 'MARKETING_VERSION');
        if (direct.length > 0) {
            for (const value of direct) requireEqual(value, marketingVersion, 'MARKETING_VERSION');
        } else if (!usesVersionConfig) {
            throw new Error('Xcode does not read MARKETING_VERSION from Version.xcconfig');
        }
        const generated = generatedValue(fixtureRoot, iosConfigPath, 'MARKETING_VERSION');
        if (generated !== null) requireEqual(generated, marketingVersion, 'generated MARKETING_VERSION');
        return `${marketingVersion} matches ${rootVersion}`;
    });

    check('iOS CURRENT_PROJECT_VERSION', () => {
        const iosProject = readFileSync(join(fixtureRoot, iosProjectPath), 'utf8');
        const usesVersionConfig = /baseConfigurationReference\s*=\s*\w+\s*\/\* Version\.xcconfig \*\//
            .test(iosProject);
        const direct = directBuildSettings(iosProject, 'CURRENT_PROJECT_VERSION');
        if (direct.length > 0) {
            for (const value of direct) requireEqual(value, versionCode, 'CURRENT_PROJECT_VERSION');
        } else if (!usesVersionConfig) {
            throw new Error('Xcode does not read CURRENT_PROJECT_VERSION from Version.xcconfig');
        }
        const generated = generatedValue(fixtureRoot, iosConfigPath, 'CURRENT_PROJECT_VERSION');
        if (generated !== null) requireEqual(generated, versionCode, 'generated CURRENT_PROJECT_VERSION');
        return `${versionCode} matches ${rootVersion}`;
    });

    check('desktop package version', () => {
        const actual = readJson(fixtureRoot, 'packages/desktop/package.json').version;
        requireEqual(actual, rootVersion, 'desktop package version');
        return `${actual} matches root`;
    });

    check('extension manifest version', () => {
        const actual = readJson(fixtureRoot, 'packages/extension/manifest.json').version;
        requireEqual(actual, rootVersion, 'extension manifest version');
        return `${actual} matches root`;
    });

    check('CHANGELOG heading', () => {
        const changelog = readFileSync(join(fixtureRoot, 'CHANGELOG.md'), 'utf8');
        const heading = new RegExp(`^## \\[${escapeRegExp(rootVersion)}\\](?:\\s|$)`, 'm');
        if (!heading.test(changelog)) throw new Error(`missing heading for ${rootVersion}`);
        return `found ## [${rootVersion}]`;
    });

    return checks;
}

export function runBuildPreflight({ root = SCRIPT_ROOT, write = console.log } = {}) {
    let checks;
    try {
        checks = inspectBuildPreflight(root);
    } catch (error) {
        checks = [{ label: 'root version', ok: false, detail: error.message }];
    }
    for (const { label, ok, detail } of checks) {
        write(`${ok ? 'PASS' : 'FAIL'} ${label}: ${String(detail).replaceAll('\n', ' ')}`);
    }
    return checks.every(({ ok }) => ok);
}

function parseRoot(args) {
    if (args.length === 0) return SCRIPT_ROOT;
    if (args.length === 2 && args[0] === '--root') return resolve(args[1]);
    throw new Error('usage: node tools/build-preflight.js [--root PATH]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = runBuildPreflight({ root: parseRoot(process.argv.slice(2)) }) ? 0 : 1;
    } catch (error) {
        console.error(`FAIL arguments: ${error.message}`);
        process.exitCode = 1;
    }
}
