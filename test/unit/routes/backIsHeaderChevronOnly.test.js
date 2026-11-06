// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// UI ruling U38: Back is only the header's bare left chevron. The header
// chevron draws no outline, border or card, and no onboarding screen carries
// an in-page Back button beside its primary action.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// A path join, not `new URL(template, import.meta.url)`: the bundler rewrites
// a templated URL into an asset glob and hands back an undefined path.
const read = (rel) => readFileSync(join(process.cwd(), 'packages/core/src', rel), 'utf8');

describe('Back is only the header chevron', () => {
    it('draws the header chevron without the outlined secondary variant', () => {
        const header = read('ui/PageHeader.jsx');
        const back = header.slice(header.indexOf('{showBack ? ('), header.indexOf(') : ('));
        expect(back).toContain('BackIcon');
        expect(back).not.toMatch(/variant="secondary"/);
    });

    it('keeps the create-wallet header Back on every step, verify included', () => {
        const source = read('shared/routes/CreateWallet.jsx');
        expect(source).not.toMatch(/onBack=\{stage === 'verify' \? undefined/);
    });

    it('renders no in-page Back button on the create-wallet verify step', () => {
        const source = read('shared/routes/CreateWallet.jsx');
        expect(source).not.toMatch(/\{t\('common\.back'\)\}/);
    });

    it('renders no in-page Back button in the onboarding carousel', () => {
        const source = read('shared/routes/OnboardingCarousel.jsx');
        expect(source).not.toMatch(/\{t\('common\.back'\)\}/);
        expect(source).not.toMatch(/Icon\.BackIcon/);
    });
});
