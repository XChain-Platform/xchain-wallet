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
    'AddressList.wif.module.css': ['1px', '1px', '2px', '1px'],
    'ContractScreens.module.css': ['200px'],
    'CreateWallet.module.css': ['96px', '2px', '1px', '1px', '1px', '520px', '64px'],
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

const routeCss = Object.fromEntries(
    [
        'ParallelComposer',
        'PollDetail',
        'Receive',
        'ResumeConfirm',
        'Send',
    ].map((route) => [
        route,
        readFileSync(`packages/core/src/shared/routes/${route}.module.css`, 'utf8'),
    ]),
);

function rule(cssText, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return cssText.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

describe('route CSS design tokens (pill radii and glyphs)', () => {
    it('uses the shared pill radius for pill-shaped route elements', () => {
        expect(rule(routeCss.ParallelComposer, '.statusPill'))
            .toMatch(/border-radius:\s*var\(--xc-radius-pill\)/);
        expect(rule(routeCss.PollDetail, '.resultTrack'))
            .toMatch(/border-radius:\s*var\(--xc-radius-pill\)/);
        expect(rule(routeCss.Send, '.toContactName'))
            .toMatch(/border-radius:\s*var\(--xc-radius-pill\)/);
        expect(rule(routeCss.Send, '.successIcon'))
            .toMatch(/border-radius:\s*var\(--xc-radius-pill\)/);
    });

    it('uses icon tokens for route glyphs covered by the icon scale', () => {
        expect(rule(routeCss.Receive, '.assetChainOverlay').match(
            /(?:width|height):\s*var\(--xc-icon-lg\)/g,
        )).toHaveLength(2);
        expect(rule(routeCss.Receive, '.assetChevron'))
            .toMatch(/font-size:\s*var\(--xc-icon-lg\)/);
        expect(rule(routeCss.Send, '.amountUnitSwap svg').match(
            /(?:width|height):\s*var\(--xc-icon-xs\)/g,
        )).toHaveLength(2);
    });

    it('does not leave token-sized raw pill radii or glyph dimensions', () => {
        for (const css of Object.values(routeCss)) {
            const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '');
            expect(declarations).not.toMatch(/border-radius:\s*999px/);
            expect(declarations).not.toMatch(
                /(?:width|height|font-size):\s*(?:14|20|24)px/,
            );
        }
    });
});
