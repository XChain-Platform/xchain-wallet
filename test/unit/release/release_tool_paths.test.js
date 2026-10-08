// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const releaseFile = (name) => resolve(repoRoot, 'tools', 'release', name);
const readReleaseFile = (name) => readFileSync(releaseFile(name), 'utf8');

const publicReleaseFiles = [
    'README.md',
    'rollback-rerelease.sh',
    'sign.sh',
];

describe('public release tool paths', () => {
    it.each(publicReleaseFiles)('%s does not expose the private reports tree', (name) => {
        const source = readReleaseFile(name);

        expect(source).not.toMatch(/claude[\\/]reports/i);
        expect(source).not.toMatch(/(?:\.\.[\\/])+claude[\\/]/i);
        expect(source).not.toMatch(/[\\/]Users[\\/][^\\/\s]+[\\/]Sites[\\/]XChain-Platform[\\/]/i);
    });

    it('documents the release-record resolver instead of a default filesystem layout', () => {
        const readme = readReleaseFile('README.md');

        expect(readme).toContain('release-record.mjs path --tag vX.Y.Z');
        expect(readme).not.toMatch(/XCHAIN_WALLET_RELEASE_RECORDS[^\n]*Defaults to/i);
    });

    it('uses the release-record resolver for rollback diagnostics', () => {
        const rollback = readReleaseFile('rollback-rerelease.sh');

        expect(rollback).toContain('RELEASE_RECORD_TOOL="$HERE/release-record.mjs"');
        expect(rollback).toContain('node "$RELEASE_RECORD_TOOL" path --tag "$GOOD_TAG"');
        expect(rollback).not.toMatch(/RELEASE_RECORD=.*wallet-releases/i);
    });

    it('points missing-key recovery at public security documentation', () => {
        const sign = readReleaseFile('sign.sh');

        expect(sign).toContain('fingerprint and current publication status are documented in SECURITY.md');
        expect(sign).not.toMatch(/SPEC_GAPS\.md/i);
    });
});
