// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siblingCheckout, skipOrFail } from '../helpers/siblingCheckout.js';
import vectorsFixture from '../fixtures/multipart_file.json';

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDORED = join(HERE, '..', 'fixtures', 'multipart_file.json');

describe('vendored multipart FILE vectors', () => {
    it('carries a non-empty vector set', () => {
        expect(Array.isArray(vectorsFixture.vectors)).toBe(true);
        expect(vectorsFixture.vectors.length).toBeGreaterThan(0);
    });

    it('is byte-identical to the documentation authority when available', (ctx) => {
        const docsRoot = process.env.XCHAIN_DOCS_ROOT;
        const canonicalPath = docsRoot
            ? join(docsRoot, 'protocol', 'test-vectors', 'multipart_file.json')
            : join(HERE, '..', '..', '..', 'xchain-documentation',
                'protocol', 'test-vectors', 'multipart_file.json');
        const docs = siblingCheckout(HERE, canonicalPath);
        const committedRoot = !docs.usable && docsRoot
            && /resolves through a symlink into the live main checkout/.test(docs.reason);
        if (committedRoot) {
            const canonical = readFileSync(canonicalPath, 'utf8');
            const committed = execFileSync('git', [
                '-C', docsRoot, 'show', 'HEAD:protocol/test-vectors/multipart_file.json',
            ], { encoding: 'utf8' });
            expect(canonical,
                'the supplied canonical vectors differ from checkout HEAD; use a clean committed checkout.'
            ).toEqual(committed);
            expect(readFileSync(VENDORED, 'utf8'),
                'vendored multipart FILE vectors drifted from the supplied checkout HEAD; ' +
                'edit the documentation authority and re-vendor every copy.'
            ).toEqual(committed);
            return;
        }
        if (!skipOrFail(ctx, docs, 'the multipart FILE vectors byte-identity guard')) return;
        expect(readFileSync(VENDORED, 'utf8'),
            'multipart FILE vectors drifted; edit the documentation authority and re-vendor every copy'
        ).toEqual(readFileSync(canonicalPath, 'utf8'));
    });
});
