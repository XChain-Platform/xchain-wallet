// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { WALLET_VERSION } from '../../packages/core/src/buildInfo.js';
import {
    versionPropertiesFor,
    versionXcconfigFor,
} from '../../packages/mobile/scripts/version.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const readJson = (path) => JSON.parse(read(path));

function filesBelow(path, accept) {
    return readdirSync(join(ROOT, path), { withFileTypes: true }).flatMap((entry) => {
        const child = join(path, entry.name);
        // Installed and dev-server cache trees (Vite writes .vite/deps/package.json)
        // are not shipping manifests.
        if (entry.isDirectory() && entry.name === 'node_modules') return [];
        if (entry.isDirectory()) return filesBelow(child, accept);
        return accept(entry.name) ? [child] : [];
    });
}

describe('wallet version lockstep', () => {
    it('uses buildInfo as the version declared by every shipping package and manifest', () => {
        const packageFiles = [
            'package.json',
            ...filesBelow('packages', (name) => name === 'package.json'),
        ];
        const versions = Object.fromEntries(
            packageFiles.map((path) => [path, readJson(path).version]),
        );

        expect(versions).toEqual(Object.fromEntries(
            packageFiles.map((path) => [path, WALLET_VERSION]),
        ));

        const manifest = readJson('packages/extension/manifest.json');
        expect(manifest.version).toBe(WALLET_VERSION);
        expect(manifest.version_name).toBe(WALLET_VERSION);
    });

    it('derives the Android and iOS user-visible versions from the same release', () => {
        const tag = `v${WALLET_VERSION}`;
        expect(versionPropertiesFor(tag)).toContain(`versionName=${WALLET_VERSION}`);
        expect(read('packages/mobile/android/app/build.gradle'))
            .toContain("versionName versionProps['versionName']");

        expect(versionXcconfigFor(tag)).toContain(`MARKETING_VERSION = ${WALLET_VERSION}`);
        expect(read('packages/mobile/ios/App/App/Info.plist'))
            .toContain('<string>$(MARKETING_VERSION)</string>');
        expect(read('packages/mobile/ios/App/App.xcodeproj/project.pbxproj'))
            .toContain('Version.xcconfig');
    });

    it('keeps the current release number out of unit-test fixtures', () => {
        const hardCoded = filesBelow('test/unit', (name) => /\.test\.[jt]sx?$/.test(name))
            .flatMap((path) => read(path).split('\n').flatMap((line, index) => (
                line.includes(WALLET_VERSION)
                    ? [`${relative(ROOT, path)}:${index + 1}`]
                    : []
            )));

        expect(hardCoded, 'import WALLET_VERSION from buildInfo instead').toEqual([]);
    });
});
