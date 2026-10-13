// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeDir = 'packages/core/src/shared/routes';
const files = [
    'ActionsMenu.module.css',
    'AddAddressModal.module.css',
    'AddressList.wif.module.css',
    'ContractScreens.module.css',
    'CreateWallet.module.css',
];
const styles = Object.fromEntries(files.map((file) => [
    file,
    readFileSync(resolve(routeDir, file), 'utf8'),
]));

const rawPixelExceptions = {
    'ActionsMenu.module.css': ['260px', '1px', '2px', '2px'],
    'AddAddressModal.module.css': ['1px', '1px'],
    'AddressList.wif.module.css': ['1px', '1px', '1px', '2px', '1px'],
    'ContractScreens.module.css': ['200px'],
    'CreateWallet.module.css': ['96px', '2px', '1px', '1px', '1px', '3px', '520px', '64px'],
};

describe('route CSS token coverage', () => {
    it('uses semantic tokens for route dimensions and typography', () => {
        expect(styles['ActionsMenu.module.css']).toMatch(
            /\.entryIcon\s*\{[^}]*width:\s*var\(--xc-control-h-md\);[^}]*height:\s*var\(--xc-control-h-md\)/s,
        );
        expect(styles['ActionsMenu.module.css']).toMatch(
            /\.entryIcon\s*>\s*svg\s*\{[^}]*width:\s*var\(--xc-icon-xl\);[^}]*height:\s*var\(--xc-icon-xl\)/s,
        );
        expect(styles['ActionsMenu.module.css']).toMatch(
            /\.statusPill\s*\{[^}]*border-radius:\s*var\(--xc-radius-pill\);[^}]*font-size:\s*var\(--xc-text-xs\)/s,
        );
        expect(styles['ContractScreens.module.css']).toMatch(
            /\.codeSource\s*\{[^}]*font-size:\s*var\(--xc-text-md\)/s,
        );
        expect(styles['CreateWallet.module.css']).toMatch(
            /\.persistingSpinner\s*\{[^}]*width:\s*var\(--xc-control-h-md\);[^}]*height:\s*var\(--xc-control-h-md\)/s,
        );
    });

    it('keeps only documented raw pixel exceptions', () => {
        for (const [file, source] of Object.entries(styles)) {
            const declarations = source.replaceAll(/\/\*[\s\S]*?\*\//g, '');
            const rawPixels = declarations.match(/\b\d+(?:\.\d+)?px\b/g) ?? [];
            expect(rawPixels, file).toEqual(rawPixelExceptions[file]);

            const lines = source.split('\n');
            for (let index = 0; index < lines.length; index += 1) {
                const line = lines[index].trim();
                if (!/\b\d+(?:\.\d+)?px\b/.test(line) || line.startsWith('/*')) continue;
                const previousLine = lines.slice(0, index).findLast((candidate) => candidate.trim()).trim();
                expect(previousLine, `${file}:${index + 1}`).toMatch(/^\/\* .+ \*\/$/);
            }
        }
    });
});
