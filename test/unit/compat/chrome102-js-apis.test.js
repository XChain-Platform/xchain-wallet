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
    CHROME_102_UNSUPPORTED_API_REGEX,
    CHROME_102_UNSUPPORTED_INSTANCE_APIS,
    CHROME_102_UNSUPPORTED_STATIC_APIS,
} from '../../smoke/_chrome102-js-apis.js';

describe('Chrome 102 JavaScript API audit', () => {
    it.each(CHROME_102_UNSUPPORTED_INSTANCE_APIS)(
        'detects instance API %s',
        (name) => {
            expect(`value.${name} ()`).toMatch(CHROME_102_UNSUPPORTED_API_REGEX);
        },
    );

    it.each(CHROME_102_UNSUPPORTED_STATIC_APIS)(
        'detects static API %s',
        (name) => {
            expect(`${name} ()`).toMatch(CHROME_102_UNSUPPORTED_API_REGEX);
        },
    );

    it('allows APIs available in Chrome 102', () => {
        const source = 'const copy = structuredClone(value); values.sort();';
        expect(source).not.toMatch(CHROME_102_UNSUPPORTED_API_REGEX);
    });
});
