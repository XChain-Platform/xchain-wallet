// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Controller bind form shows its action classes as checkboxes. The
// regtest spec cannot run without a stack, so pin by source that it drives
// the checkboxes and no longer a select.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SPEC = readFileSync(
    resolve(process.cwd(), 'test/e2e/tests/tokens/controller-bind.regtest.spec.js'),
    'utf8',
);

describe('controller-bind regtest spec action class control', () => {
    it('does not drive the action class as a select', () => {
        expect(SPEC).not.toMatch(/selectOption/);
        expect(SPEC).not.toMatch(/getByLabel\('Action class'\)/);
    });

    it('routes every choice through the checkbox helper', () => {
        const calls = SPEC.match(/await chooseActionClass\(form, /g) || [];
        expect(calls.length).toBe(4);
    });

    it('fails on a missing checkbox and leaves exactly one ticked', () => {
        const body = SPEC.slice(SPEC.indexOf('async function chooseActionClass'));
        const helper = body.slice(0, body.indexOf('\n}\n'));
        expect(helper).toMatch(/getByRole\('checkbox', \{ name: actionClass, exact: true \}\)/);
        expect(helper).toMatch(/toBeVisible\(\)/);
        expect(helper).toMatch(/\.uncheck\(\)/);
        expect(helper).toMatch(/\.check\(\)/);
        expect(helper).toMatch(/toHaveCount\(1\)/);
    });
});
