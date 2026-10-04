// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    detectBrowserFamilyForWebHidHint,
    isWebHidSupported,
} from '../../../../packages/core/src/shared/utils/webhidSupport.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('isWebHidSupported', () => {
    it('returns false when navigator is unavailable', () => {
        vi.stubGlobal('navigator', undefined);
        expect(isWebHidSupported()).toBe(false);
    });

    it('returns true when navigator.hid is an object', () => {
        vi.stubGlobal('navigator', { hid: {} });
        expect(isWebHidSupported()).toBe(true);
    });

    it.each([
        ['absent', {}],
        ['null', { hid: null }],
    ])('returns false when navigator.hid is %s', (_label, navigator) => {
        vi.stubGlobal('navigator', navigator);
        expect(isWebHidSupported()).toBe(false);
    });
});

describe('detectBrowserFamilyForWebHidHint', () => {
    it('returns unknown when navigator is unavailable', () => {
        vi.stubGlobal('navigator', undefined);
        expect(detectBrowserFamilyForWebHidHint()).toBe('unknown');
    });

    it.each([
        ['firefox', 'Mozilla/5.0 Firefox/128.0', 'firefox'],
        ['safari', 'Mozilla/5.0 Version/17.6 Safari/605.1.15', 'safari'],
        ['chrome', 'Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36', 'unknown'],
        ['edge', 'Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0', 'unknown'],
        ['empty', '', 'unknown'],
    ])('identifies a %s user agent', (_label, userAgent, expected) => {
        vi.stubGlobal('navigator', { userAgent });
        expect(detectBrowserFamilyForWebHidHint()).toBe(expected);
    });
});
