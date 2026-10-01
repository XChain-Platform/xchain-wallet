// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_NAMES = ['web', 'extension', 'desktop'];
const SDK_PIN_PATTERN = /^npm:@dankest-llc\/xchain-sdk@[0-9]+\.[0-9]+\.[0-9]+$/;
const repoFile = (path) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

function yamlScalar(value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith("'") && trimmed.endsWith("'"))
        || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function lockfileSdkEntries(lockfileText) {
    const wantedImporters = new Set(PACKAGE_NAMES.map((name) => `packages/${name}`));
    const entries = new Map();
    let inImporters = false;
    let importer = null;
    let section = null;
    let dependency = null;

    for (const line of lockfileText.split(/\r?\n/)) {
        if (!inImporters) {
            if (line === 'importers:') inImporters = true;
            continue;
        }
        if (/^\S/.test(line)) break;

        const importerMatch = line.match(/^  (\S[^:]*):\s*$/);
        if (importerMatch) {
            importer = wantedImporters.has(importerMatch[1]) ? importerMatch[1] : null;
            section = null;
            dependency = null;
            continue;
        }
        if (!importer) continue;

        const sectionMatch = line.match(/^    (\S[^:]*):\s*$/);
        if (sectionMatch) {
            section = sectionMatch[1];
            dependency = null;
            continue;
        }

        const dependencyMatch = line.match(/^      (\S[^:]*):\s*$/);
        if (dependencyMatch) {
            dependency = section === 'dependencies' ? dependencyMatch[1] : null;
            if (dependency === 'xchain-sdk') entries.set(importer, {});
            continue;
        }

        if (dependency !== 'xchain-sdk') continue;
        const fieldMatch = line.match(/^        (specifier|version):\s*(.+?)\s*$/);
        if (fieldMatch) entries.get(importer)[fieldMatch[1]] = yamlScalar(fieldMatch[2]);
    }

    return entries;
}

export function sdkPinDisagreements(webText, extensionText, desktopText, lockfileText) {
    const packageTexts = [webText, extensionText, desktopText];
    const pins = new Map();
    const disagreements = [];

    for (const [index, name] of PACKAGE_NAMES.entries()) {
        let manifest;
        try {
            manifest = JSON.parse(packageTexts[index]);
        } catch (error) {
            disagreements.push(`packages/${name}/package.json is not valid JSON: ${error.message}`);
            continue;
        }

        const pin = manifest.dependencies?.['xchain-sdk'];
        if (!SDK_PIN_PATTERN.test(pin)) {
            disagreements.push(`packages/${name}/package.json has an invalid xchain-sdk pin: ${String(pin)}`);
            continue;
        }
        pins.set(name, pin);
    }

    if (pins.size === PACKAGE_NAMES.length && new Set(pins.values()).size !== 1) {
        disagreements.push('Package xchain-sdk pins disagree: '
            + PACKAGE_NAMES.map((name) => `packages/${name}=${pins.get(name)}`).join(', '));
    }

    const expectedPin = pins.get('web');
    if (!expectedPin) return disagreements;
    const expectedVersion = `@dankest-llc/xchain-sdk@${expectedPin.slice(expectedPin.lastIndexOf('@') + 1)}`;
    const lockEntries = lockfileSdkEntries(lockfileText);

    for (const name of PACKAGE_NAMES) {
        const importer = `packages/${name}`;
        const entry = lockEntries.get(importer);
        if (!entry) {
            disagreements.push(`pnpm-lock.yaml ${importer} has no xchain-sdk dependency`);
            continue;
        }
        if (entry.specifier !== expectedPin) {
            disagreements.push(`pnpm-lock.yaml ${importer} xchain-sdk specifier is ${String(entry.specifier)}, expected ${expectedPin}`);
        }
        if (entry.version !== expectedVersion) {
            disagreements.push(`pnpm-lock.yaml ${importer} xchain-sdk version is ${String(entry.version)}, expected ${expectedVersion}`);
        }
    }

    return disagreements;
}

function nextPatchPin(pin) {
    return pin.replace(/([0-9]+)\.([0-9]+)\.([0-9]+)$/, (_, major, minor, patch) => (
        `${major}.${minor}.${Number(patch) + 1}`
    ));
}

const packageTexts = Object.fromEntries(PACKAGE_NAMES.map((name) => [
    name,
    readFileSync(repoFile(`packages/${name}/package.json`), 'utf8'),
]));
const lockfileText = readFileSync(repoFile('pnpm-lock.yaml'), 'utf8');
const currentPin = JSON.parse(packageTexts.web).dependencies['xchain-sdk'];
const bumpedPin = nextPatchPin(currentPin);

describe('xchain-sdk package and lockfile pins', () => {
    it('keeps every package manifest and lockfile importer in agreement', () => {
        expect(sdkPinDisagreements(
            packageTexts.web,
            packageTexts.extension,
            packageTexts.desktop,
            lockfileText
        )).toEqual([]);
    });

    it('reports a package bumped without the other package manifests', () => {
        const bumpedWeb = packageTexts.web.replace(currentPin, bumpedPin);
        const disagreements = sdkPinDisagreements(
            bumpedWeb,
            packageTexts.extension,
            packageTexts.desktop,
            lockfileText
        );

        expect(disagreements.some((message) => message.startsWith('Package xchain-sdk pins disagree:')))
            .toBe(true);
    });

    it('reports package manifests bumped without refreshing the lockfile', () => {
        const bumpedPackages = PACKAGE_NAMES.map((name) => packageTexts[name].replace(
            currentPin,
            bumpedPin
        ));
        const disagreements = sdkPinDisagreements(...bumpedPackages, lockfileText);

        expect(disagreements.filter((message) => message.startsWith('pnpm-lock.yaml')))
            .toHaveLength(PACKAGE_NAMES.length * 2);
    });
});
