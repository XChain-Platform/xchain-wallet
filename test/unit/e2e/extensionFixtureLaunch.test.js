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
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The stock extension fixture launches a persistent Chromium context. It keeps
// every outside host unresolvable and keeps its profile under the Playwright
// output dir.
const source = fs.readFileSync(fileURLToPath(new URL('../../e2e/fixtures/extension.js', import.meta.url)), 'utf8');

describe('stock extension fixture launch', () => {
    it('passes the full host-resolver rule', () => {
        expect(source).toContain("'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'");
    });

    it('keeps the profile under the Playwright output dir, not the system temp dir', () => {
        expect(source).toContain('testInfo.outputDir');
        expect(source).not.toMatch(/os\.tmpdir|from 'os'/);
    });
});
