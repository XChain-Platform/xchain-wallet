// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Layout pins for two e2e-found bugs (the real-browser proof is
// layout/settings-security-dropdowns.spec.js and layout/list-full-width.spec.js).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

describe('dropdown settings rows at 360px', () => {
    const css = read('packages/core/src/shared/components/settings/SettingsInlineRow.module.css');

    it('wrap the control under the copy instead of cutting the title', () => {
        expect(css).toMatch(/\.row\.row\[data-settings-inline='select'\]\s*\{[^}]*flex-wrap:\s*wrap/s);
    });

    it('keep the title width in the copy column so a wide control wraps first', () => {
        expect(css).toMatch(/\.row\.row\[data-settings-inline='select'\] > \.copy\s*\{[^}]*min-width:\s*min-content/s);
        expect(css).toMatch(/\.row\.row\[data-settings-inline='select'\] \.title\s*\{[^}]*min-width:\s*max-content/s);
    });

    it('clip the title rather than scroll it, which hides its width from the copy column', () => {
        expect(css).toMatch(/\.row\[data-settings-inline='select'\] \.title\s*\{[^}]*overflow:\s*clip/s);
        expect(css).not.toMatch(/\.row\[data-settings-inline='select'\] \.title\s*\{[^}]*overflow:\s*hidden/s);
    });
});

describe('the wide onboarding column', () => {
    const css = read('packages/core/src/shared/routes/Onboarding.module.css');

    it('has an end gutter equal to the start gutter so a centred card sits at the page centre', () => {
        expect(css).toMatch(/\.wideCentre\.wideCentre\.wideCentre\s*\{[^}]*padding-inline-end:\s*var\(--xc-space-2\)/s);
    });
});
