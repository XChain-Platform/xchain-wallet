// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    auditLoadedWorkspace,
    extractPackageImports,
} from '../../../tools/dependency-audit.mjs';

describe('dependency audit', () => {
    it('extracts static package imports without treating builtins as packages', () => {
        const imports = extractPackageImports(`
            import react from 'react';
            export { thing } from '@scope/library/subpath';
            const lazy = import('lazy-package');
            const commonJs = require('common-js/subpath');
            const mocked = vi.mock('mocked-package');
            import fs from 'node:fs';
            import local from './local.js';
        `);

        expect([...imports].sort()).toEqual([
            '@scope/library',
            'common-js',
            'lazy-package',
            'mocked-package',
            'react',
        ]);
    });

    it('reports undeclared imports and dependencies with no source or script use', () => {
        const manifests = [{
            path: 'package.json',
            directory: '',
            package: {
                name: 'fixture',
                scripts: { build: 'fixture-cli build' },
                dependencies: {
                    'used-package': '1.0.0',
                    'config-package': '1.0.0',
                    'script-package': '1.0.0',
                    'unused-package': '1.0.0',
                },
            },
        }];
        const binsByManifest = new Map([[
            'package.json',
            new Map([['script-package', ['fixture-cli']]]),
        ]]);
        const [result] = auditLoadedWorkspace({
            manifests,
            binsByManifest,
            files: [{
                path: 'src/index.js',
                source: `
                    import 'used-package';
                    import 'missing-package/subpath';
                    export const plugins = ['load config-package during setup'];
                `,
            }],
        });

        expect(result.unused).toEqual(['unused-package']);
        expect(result.undeclared).toEqual([{
            dependency: 'missing-package',
            files: ['src/index.js'],
        }]);
    });

    it('attributes files to the nearest package manifest', () => {
        const results = auditLoadedWorkspace({
            manifests: [
                { path: 'package.json', directory: '', package: { name: 'root' } },
                {
                    path: 'packages/app/package.json',
                    directory: 'packages/app',
                    package: { name: '@fixture/app' },
                },
            ],
            files: [
                { path: 'root.js', source: "import 'root-missing';" },
                { path: 'packages/app/index.js', source: "import 'app-missing';" },
            ],
        });

        expect(results[0].undeclared[0].dependency).toBe('root-missing');
        expect(results[1].undeclared[0].dependency).toBe('app-missing');
    });

    it('keeps peer dependencies required by a used package', () => {
        const metadataByManifest = new Map([[
            'package.json',
            new Map([['renderer', { bins: [], peers: ['react'] }]]),
        ]]);
        const [result] = auditLoadedWorkspace({
            metadataByManifest,
            manifests: [{
                path: 'package.json',
                directory: '',
                package: {
                    name: 'fixture',
                    dependencies: { renderer: '1.0.0', react: '1.0.0' },
                },
            }],
            files: [{ path: 'index.js', source: "import 'renderer';" }],
        });

        expect(result.unused).toEqual([]);
    });
});
