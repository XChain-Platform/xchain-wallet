// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';

import {
    versionPropertiesFor,
    versionXcconfigFor,
} from '../../../packages/mobile/scripts/version.js';

describe('Wear version properties', () => {
    it('writes the phone and Wear codes for a stable release', () => {
        const properties = versionPropertiesFor('v0.333.1');

        expect(properties).toContain('versionCode=3330150');
        expect(properties).toContain('versionName=0.333.1\nwearVersionCode=1003330150');
    });

    it('writes the maximum representable Wear code', () => {
        expect(versionPropertiesFor('v109.999.99-respin.49'))
            .toContain('wearVersionCode=2099999999');
    });

    it('keeps every property line safe for Gradle parsing', () => {
        const lines = versionPropertiesFor('v109.999.99-respin.49')
            .split('\n')
            .filter((line) => line && !line.startsWith('#'));

        for (const line of lines) {
            expect(line).toMatch(/^[A-Za-z]+=[\w.\-]+$/);
        }
    });

    it('does not add a Wear key to the xcconfig', () => {
        expect(versionXcconfigFor('v0.333.1')).not.toMatch(/wear/i);
    });
});
