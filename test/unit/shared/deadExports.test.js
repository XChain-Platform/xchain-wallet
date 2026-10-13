// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

const MODULE_EXPORTS = {
    'packages/core/src/shared/components/OriginIdentity.jsx': [
        'originIdentityDetails',
        'originHostEnding',
    ],
    'packages/core/src/shared/components/settings/AboutSection.jsx': ['buildProblemReportUrl'],
    'packages/core/src/shared/utils/explorerLinks.js': ['explorerBaseUrl'],
    'packages/core/src/ui/reducedMotion.js': [
        'osPrefersReducedMotion',
        'subscribeReducedMotion',
    ],
    'packages/core/src/ui/index.js': [
        'osPrefersReducedMotion',
        'subscribeReducedMotion',
    ],
};

function exportedNames(relativePath) {
    const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const names = [];
    for (const node of ast.program.body) {
        if (node.type !== 'ExportNamedDeclaration') continue;
        if (node.declaration?.id?.name) names.push(node.declaration.id.name);
        for (const declaration of node.declaration?.declarations || []) {
            if (declaration.id.type === 'Identifier') names.push(declaration.id.name);
        }
        for (const specifier of node.specifiers) names.push(specifier.exported.name);
    }
    return names;
}

describe('internal shared and UI helpers', () => {
    it('do not remain in module export surfaces', () => {
        for (const [relativePath, internalNames] of Object.entries(MODULE_EXPORTS)) {
            const names = exportedNames(relativePath);
            for (const internalName of internalNames) {
                expect(names).not.toContain(internalName);
            }
        }
    });
});
