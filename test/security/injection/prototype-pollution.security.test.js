// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Security: schema validators must not be tricked by prototype-
// pollution-shaped records. An attacker who can write to localStorage
// (XSS, malicious extension) shouldn't be able to inject `__proto__`
// or `constructor` keys that survive validation and corrupt every
// other Object instance the wallet creates.

import { describe, it, expect } from 'vitest';
import { validateMultisigConfig } from '../../../packages/core/src/schemas/multisigConfig.js';

describe('security/injection/prototype-pollution', () => {
    it('refuses a record whose body is __proto__-shaped', () => {
        const r = JSON.parse('{"__proto__":{"polluted":true}}');
        const result = validateMultisigConfig(r);
        expect(result.ok).toBe(false);
        // Prove that even after the call, no global Object pollution
        // happened.
        expect({}.polluted).toBeUndefined();
    });

    it('refuses a record with a `constructor` key', () => {
        const r = { constructor: { prototype: { polluted: true } } };
        const result = validateMultisigConfig(r);
        expect(result.ok).toBe(false);
        expect({}.polluted).toBeUndefined();
    });
});
