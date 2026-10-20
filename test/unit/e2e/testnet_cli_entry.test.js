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
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'e2e', 'fixtures');

describe('testnet CLI entry through a symlinked path', () => {
    it('runs the evidence reader and the run input builder through a link', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'testnet-cli-entry-'));
        try {
            const link = path.join(tmp, 'fixtures');
            fs.symlinkSync(FIXTURES, link, 'dir');

            const evidence = spawnSync(
                process.execPath,
                [path.join(link, 'testnet_evidence.js'), path.join(tmp, 'no-such-report.json')],
                { encoding: 'utf8' },
            );
            expect(evidence.status).toBe(2);
            expect(evidence.stderr).toContain('cannot read testnet report');

            const runInput = spawnSync(
                process.execPath,
                [path.join(link, 'testnet_run_input.js')],
                { encoding: 'utf8' },
            );
            expect(runInput.status).toBe(2);
            expect(runInput.stderr).toContain('usage: node test/e2e/fixtures/testnet_run_input.js');
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('resolves the entry path with realpathSync in every testnet CLI fixture', () => {
        const files = fs.readdirSync(FIXTURES).filter((f) => /^testnet.*\.js$/.test(f));
        const naming = files.filter((f) => fs.readFileSync(path.join(FIXTURES, f), 'utf8').includes('process.argv[1]'));
        expect(naming.length).toBeGreaterThanOrEqual(4);
        for (const f of naming) {
            const text = fs.readFileSync(path.join(FIXTURES, f), 'utf8');
            expect(text, f).toContain('realpathSync(process.argv[1])');
            expect(text, f).not.toContain('path.resolve(process.argv[1])');
        }
    });
});
