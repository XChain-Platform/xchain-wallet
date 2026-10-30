// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// packages/web/vite.config.js binds dev and preview to 0.0.0.0 for LAN demos.
// An e2e run drives a throwaway wallet over plain HTTP, so every server a
// Playwright config starts passes `--host 127.0.0.1` on its command line and
// stays off the machine's other network interfaces.
const E2E_DIR = fileURLToPath(new URL('../../e2e/', import.meta.url));
const configs = fs.readdirSync(E2E_DIR).filter((name) => /^playwright\..*config\.js$/.test(name));

const SERVER_STEP = /pnpm -C \S+ (?:exec vite|dev|preview)\b/;

// Server-starting steps of every backtick-quoted command string in a config.
function serverSteps(name) {
    const source = fs.readFileSync(path.join(E2E_DIR, name), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    const strings = source.match(/`[^`]*`/g) ?? [];
    return strings.flatMap((str) => str.split('&&')).filter((step) => SERVER_STEP.test(step));
}

describe('e2e servers bind to loopback', () => {
    it('finds the configs that start servers', () => {
        expect(configs.filter((name) => serverSteps(name).length > 0).length).toBeGreaterThanOrEqual(10);
    });

    for (const name of configs) {
        it(`${name} starts no server without --host 127.0.0.1`, () => {
            for (const step of serverSteps(name)) {
                expect(step).toMatch(/--host 127\.0\.0\.1(\s|`|$)/);
            }
        });
    }
});
