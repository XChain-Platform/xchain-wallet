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
import { deriveExtensionVersion } from '../../../packages/core/scripts/derive-extension-version.js';

describe('deriveExtensionVersion', () => {
    it('maps a stable wallet version to the same manifest version', () => {
        expect(deriveExtensionVersion('12.34.56')).toBe('12.34.56');
    });

    it('maps an rc prerelease to a lower four-segment manifest version', () => {
        expect(deriveExtensionVersion('12.34.56-rc.789')).toBe('0.12.34.789');
    });

    it('rejects build metadata with the documented shape error', () => {
        expect(() => deriveExtensionVersion('1.2.3+build.7')).toThrowError(
            new Error('deriveExtensionVersion: unrecognized wallet version "1.2.3+build.7"; '
                + "expected 'M.m.p' or 'M.m.p-rc.N'"),
        );
    });

    it('rejects malformed input with the documented shape error', () => {
        expect(() => deriveExtensionVersion('1.2.3-beta.1')).toThrowError(
            new Error('deriveExtensionVersion: unrecognized wallet version "1.2.3-beta.1"; '
                + "expected 'M.m.p' or 'M.m.p-rc.N'"),
        );
    });
});
