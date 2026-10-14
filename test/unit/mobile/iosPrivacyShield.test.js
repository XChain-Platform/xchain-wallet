// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const sceneDelegate = readFileSync(
    join(here, '..', '..', '..', 'packages', 'mobile', 'ios', 'App', 'App', 'SceneDelegate.swift'),
    'utf8',
).split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');

function functionBody(name) {
    const signature = new RegExp(`(?:private )?func ${name}\\b`);
    const start = sceneDelegate.search(signature);
    expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);

    const open = sceneDelegate.indexOf('{', start);
    let depth = 0;
    for (let index = open; index < sceneDelegate.length; index += 1) {
        if (sceneDelegate[index] === '{') depth += 1;
        if (sceneDelegate[index] !== '}') continue;
        depth -= 1;
        if (depth === 0) return sceneDelegate.slice(open + 1, index);
    }
    throw new Error(`${name} has no closing brace`);
}

describe('the iOS app-switcher privacy shield', () => {
    it('covers before the snapshot and reasserts the cover on background entry', () => {
        expect(functionBody('sceneWillResignActive')).toMatch(/showPrivacyCover\(\)/);
        expect(functionBody('sceneDidEnterBackground')).toMatch(/showPrivacyCover\(\)/);

        const show = functionBody('showPrivacyCover');
        expect(show).toMatch(/UIView\(frame: window\.bounds\)/);
        expect(show).toMatch(/backgroundColor = UIColor\([\s\S]*?alpha: 1\.0\)/);
        expect(show).toMatch(/autoresizingMask = \[\.flexibleWidth, \.flexibleHeight\]/);
        expect(show).toMatch(/window\.addSubview\(cover\)/);
        expect(show).toMatch(/privacyCover = cover/);
        expect(show).toMatch(/window\.bringSubviewToFront\(cover\)/);
    });

    it('removes and releases the cover only after the scene becomes active', () => {
        expect(functionBody('sceneDidBecomeActive')).toMatch(/hidePrivacyCover\(\)/);

        const hide = functionBody('hidePrivacyCover');
        expect(hide).toMatch(/privacyCover\?\.removeFromSuperview\(\)/);
        expect(hide).toMatch(/privacyCover = nil/);
    });
});
