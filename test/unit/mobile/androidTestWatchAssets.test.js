// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const APP_DIR = join(REPO_ROOT, 'packages/mobile/android/app');
const GRADLE_PATH = join(APP_DIR, 'build.gradle');
const WATCH_FIXTURE_PATH = 'test/fixtures/watch';
const appGradle = readFileSync(GRADLE_PATH, 'utf8');

function namedBlock(source, name) {
    const opening = new RegExp(`\\b${name}\\s*\\{`).exec(source);
    expect(opening, `missing ${name} block`).not.toBeNull();

    const start = source.indexOf('{', opening.index);
    let depth = 0;
    for (let index = start; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start + 1, index);
    }
    throw new Error(`unterminated ${name} block`);
}

describe('Android instrumented watch fixture assets', () => {
    it('packages the shared watch fixtures only in the androidTest APK', () => {
        expect(appGradle.split(WATCH_FIXTURE_PATH)).toHaveLength(2);

        const sourceSets = namedBlock(namedBlock(appGradle, 'android'), 'sourceSets');
        const androidTest = namedBlock(sourceSets, 'androidTest');
        const assetLines = appGradle.split('\n')
            .filter((line) => line.includes('assets.srcDirs'));

        expect(sourceSets).not.toMatch(/\bmain\s*\{/);
        expect(assetLines).toHaveLength(1);
        expect(androidTest).toContain(assetLines[0].trim());

        const fixture = /assets\.srcDirs\s*\+=\s*\[['"]([^'"]+)['"]\]/
            .exec(androidTest);
        expect(fixture, 'missing quoted androidTest asset path').not.toBeNull();
        expect(resolve(APP_DIR, fixture[1])).toBe(join(REPO_ROOT, WATCH_FIXTURE_PATH));
    });
});
