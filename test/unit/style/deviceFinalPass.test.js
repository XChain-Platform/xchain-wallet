// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Device pass findings whose cause was stylesheet order or shell wiring: the
// desktop and extension bundles load the kit Button stylesheet after route
// stylesheets, so a single-class route override lost to the Button variant.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
// Every <Button ...> opening tag that carries the class, read up to the class
// attribute so nested JSX in earlier props does not cut the tag short.
const buttonsWith = (jsx, classExpr) => {
    const out = [];
    let at = jsx.indexOf(classExpr);
    while (at >= 0) {
        out.push(jsx.slice(jsx.lastIndexOf('<Button', at), at));
        at = jsx.indexOf(classExpr, at + 1);
    }
    return out;
};
const rule = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`(^|\\n)${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
};

describe('device pass layout guards', () => {
    it('keeps Home quick-action tiles secondary and outranking the Button variant', () => {
        const jsx = read('packages/core/src/shared/routes/Home.jsx');
        const css = read('packages/core/src/shared/routes/Home.module.css');
        const tiles = buttonsWith(jsx, 'className={styles.quickAction}');
        expect(tiles.length).toBeGreaterThanOrEqual(5);
        for (const tile of tiles) expect(tile).toContain('variant="secondary"');
        expect(css).not.toMatch(/(^|\n)\.quickAction\s*\{/);
        expect(rule(css, '.quickActions .quickAction')).toMatch(/background:\s*var\(--xc-surface-raised\)/);
    });

    it('keeps the account and wallet row button outlined at the row end', () => {
        const css = read('packages/core/src/shared/routes/WalletPicker.module.css');
        expect(css).not.toMatch(/(^|\n)\.rowMenuBtn\s*\{/);
        expect(rule(css, '.rowWrap .rowMenuBtn')).toMatch(/position:\s*absolute/);
        for (const file of ['AccountPicker.jsx', 'WalletPicker.jsx']) {
            const jsx = read(`packages/core/src/shared/routes/${file}`);
            const buttons = buttonsWith(jsx, 'className={pickerStyles.rowMenuBtn}');
            expect(buttons.length, file).toBeGreaterThan(0);
            for (const button of buttons) expect(button, file).toContain('variant="secondary"');
        }
    });

    it('stacks icon over label in the four-column Home action grid', () => {
        const css = read('packages/core/src/shared/routes/Home.module.css');
        expect(css).toMatch(/\n\.actionsFull > button\s*\{[^}]*flex-direction:\s*column/s);
    });

    it('keeps stacked Home action icons on one line when a label wraps', () => {
        const css = read('packages/core/src/shared/routes/Home.module.css');
        expect(css).toMatch(/\n\.actionsFull > button\s*\{[^}]*justify-content:\s*flex-start/s);
    });

    it('hides a search-only header menu when the rail shows Search', () => {
        const css = read('packages/core/src/shared/components/LeftNav.module.css');
        expect(css).toMatch(/\.layout\[data-xc-rail='shown'\] :global\(\[data-header-menu='search-only'\]\)\s*\{\s*display:\s*none;/);
    });

    it('shows no reachability notice for a demo wallet in any shell', () => {
        for (const file of ['packages/web/src/App.jsx', 'packages/desktop/renderer/App.jsx', 'packages/extension/src/popup/App.jsx']) {
            const source = read(file);
            expect(source, file).toMatch(/isDemoWallet\(activeWalletId\) \? null : <ReachabilityBanner \/>/);
            expect(source.match(/<ReachabilityBanner \/>/g), file).toHaveLength(1);
        }
    });
});
