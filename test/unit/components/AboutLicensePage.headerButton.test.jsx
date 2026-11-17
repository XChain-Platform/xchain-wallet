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
import { describe, it, expect } from 'vitest';

const aboutSource = readFileSync('packages/core/src/shared/components/settings/AboutSection.jsx', 'utf8');
const settingsSource = readFileSync('packages/core/src/shared/routes/Settings.jsx', 'utf8');

describe('removed About license page', () => {
    it('has no in-app license page or header button', () => {
        expect(aboutSource).not.toContain('AboutLicensePage');
        expect(aboutSource).not.toContain('LicenseHeaderButton');
        expect(aboutSource).not.toContain('full-license-text');
    });

    it('has no Settings child route for the license', () => {
        expect(settingsSource).not.toContain("id: 'about-license'");
        expect(settingsSource).not.toContain("openChildPage('about-license')");
    });
});
