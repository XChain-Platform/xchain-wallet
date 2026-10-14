// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { resolveDocsRoot } from '../smoke/_run-smokes.js';

describe('smoke runner docs root', () => {
    const repoRoot = resolve('/workspace/tmp/lanes/lane-name/xchain-wallet');
    const sibling = resolve(repoRoot, '..', 'xchain-documentation');
    const commonDir = resolve('/workspace/xchain-wallet/.git');
    const platform = resolve(commonDir, '..', '..', 'xchain-documentation');

    it('gives XCHAIN_DOCS_ROOT first priority', () => {
        const getGitCommonDir = vi.fn();
        const result = resolveDocsRoot({
            env: { XCHAIN_DOCS_ROOT: '/explicit/docs' },
            repoRoot,
            exists: () => true,
            getGitCommonDir,
        });

        expect(result).toEqual({ root: '/explicit/docs', source: 'XCHAIN_DOCS_ROOT' });
        expect(getGitCommonDir).not.toHaveBeenCalled();
    });

    it('prefers the checkout beside the repo', () => {
        const result = resolveDocsRoot({
            env: {},
            repoRoot,
            exists: (path) => path === sibling || path === platform,
            getGitCommonDir: () => commonDir,
        });

        expect(result).toEqual({ root: sibling, source: 'adjacent checkout' });
    });

    it('falls back to the platform checkout for a lane worktree', () => {
        const result = resolveDocsRoot({
            env: {},
            repoRoot,
            exists: (path) => path === platform,
            getGitCommonDir: () => commonDir,
        });

        expect(result).toEqual({ root: platform, source: 'platform checkout' });
    });
});
