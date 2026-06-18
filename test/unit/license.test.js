// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: license.js - LICENSE_SUMMARY + LICENSE_TEXT constants.

import { describe, it, expect } from 'vitest';
import { LICENSE_SUMMARY, LICENSE_TEXT } from '../../packages/core/src/license.js';

describe('license', () => {
    describe('LICENSE_SUMMARY', () => {
        it('is a non-empty string', () => {
            expect(typeof LICENSE_SUMMARY).toBe('string');
            expect(LICENSE_SUMMARY.length).toBeGreaterThan(0);
        });

        it('mentions AGPL', () => {
            expect(LICENSE_SUMMARY).toMatch(/AGPL/);
        });

        it('contains the commercial contact email', () => {
            expect(LICENSE_SUMMARY).toContain('legal@dankest.llc');
        });
    });

    describe('LICENSE_TEXT', () => {
        it('is a non-empty string', () => {
            expect(typeof LICENSE_TEXT).toBe('string');
            expect(LICENSE_TEXT.length).toBeGreaterThan(100);
        });

        it('starts with the AGPL header', () => {
            expect(LICENSE_TEXT.trim()).toMatch(/GNU AFFERO GENERAL PUBLIC LICENSE/);
        });

        it('contains the version 3 marker', () => {
            expect(LICENSE_TEXT).toContain('Version 3');
        });

        it('ends with a newline (canonical license file format)', () => {
            expect(LICENSE_TEXT.endsWith('\n')).toBe(true);
        });
    });
});
