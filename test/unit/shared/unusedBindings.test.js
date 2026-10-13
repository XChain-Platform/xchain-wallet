// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { basename } from 'node:path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { describe, expect, it } from 'vitest';

import { cachedSource } from '../../helpers/sourceScan.js';

const traverse = _traverse.default || _traverse;

const sourceFiles = [
    'packages/core/src/shared/components/HomeTabs.jsx',
    'packages/core/src/shared/components/TxStatusTimeline.jsx',
    'packages/core/src/shared/routes/AirdropForm.jsx',
    'packages/core/src/shared/routes/CallbackForm.jsx',
    'packages/core/src/shared/routes/ContactsList.jsx',
    'packages/core/src/shared/routes/CrossChainTemplates.jsx',
    'packages/core/src/shared/routes/DispenserExplorer.jsx',
    'packages/core/src/shared/routes/History.jsx',
    'packages/core/src/shared/routes/Home.jsx',
    'packages/core/src/shared/routes/MarketsList.jsx',
    'packages/core/src/shared/routes/MintForm.jsx',
    'packages/core/src/shared/routes/OracleConsole.jsx',
    'packages/core/src/shared/routes/ParallelComposer.jsx',
    'packages/core/src/shared/routes/PsbtSignForm.jsx',
    'packages/core/src/shared/routes/Receive.jsx',
    'packages/core/src/shared/routes/Send.jsx',
    'packages/core/src/shared/routes/SignMessageForm.jsx',
    'packages/core/src/shared/routes/StakeDetail.jsx',
    'packages/core/src/shared/routes/TokenDetail.jsx',
    'packages/extension/src/approval/kinds/SignApproval.jsx',
    'packages/extension/src/popup/App.jsx',
];

function exportedBinding(binding, scopePath) {
    for (let path = binding.path; path && path !== scopePath; path = path.parentPath) {
        if (path.isExportNamedDeclaration() || path.isExportDefaultDeclaration()) return true;
    }
    return false;
}

function unusedBindings(relativePath) {
    const source = cachedSource(relativePath);
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const unused = [];

    traverse(ast, {
        Scope(path) {
            for (const [name, binding] of Object.entries(path.scope.bindings)) {
                if (binding.referenced) continue;
                if (!['module', 'const', 'let', 'var', 'hoisted'].includes(binding.kind)) continue;
                if (binding.path.isCatchClause() || name.startsWith('_')) continue;
                if (exportedBinding(binding, path)) continue;
                unused.push(`${basename(relativePath)}:${binding.identifier.loc.start.line}:${name}`);
            }
        },
    });

    return unused;
}

describe('shared shell source bindings', () => {
    it('does not retain unreferenced imports or local declarations', () => {
        expect(sourceFiles.flatMap(unusedBindings)).toEqual([]);
    });
});
