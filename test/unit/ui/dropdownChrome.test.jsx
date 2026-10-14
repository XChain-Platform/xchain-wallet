// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every dropdown looks like the Network picker.
//
// The shared Select and the plain native selects used to show the browser's
// own arrow while the Network picker and the network filter drew a custom
// chevron. jsdom computes no layout, so these checks read the rendered
// markup and the stylesheet text.

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Select } from '../../../packages/core/src/ui/Select.jsx';
import { NetworkFilter } from '../../../packages/core/src/shared/components/NetworkFilter.jsx';
import { ChevronDownIcon } from '../../../packages/core/src/ui/icons/index.jsx';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const tokensCss = read('packages/core/src/ui/tokens.css');
const ARROW_RULE = 'select:not([multiple]):not([size])';

/** Body of the first rule whose selector is exactly `selector`, at any indent. */
function ruleBody(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
}

function sourceFiles(dir, pattern) {
    const out = [];
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) out.push(...sourceFiles(path, pattern));
        else if (pattern.test(name) && !/\.test\./.test(name)) out.push(path);
    }
    return out;
}

function packageSources(pattern) {
    const files = [];
    for (const pkg of readdirSync(join(root, 'packages'))) {
        const src = join(root, 'packages', pkg, 'src');
        try { statSync(src); } catch { continue; }
        files.push(...sourceFiles(src, pattern));
    }
    return files;
}

function renderedChevron() {
    const { container } = render(<ChevronDownIcon />);
    const svg = container.querySelector('svg');
    const shape = {
        d: svg.querySelector('path').getAttribute('d'),
        width: svg.getAttribute('width'),
        strokeWidth: svg.getAttribute('stroke-width'),
    };
    cleanup();
    return shape;
}

afterEach(cleanup);

describe('dropdown chrome', () => {
    it('hides the browser arrow on every select and draws the shared chevron instead', () => {
        const rule = ruleBody(tokensCss, ARROW_RULE);
        expect(rule).not.toBeNull();
        expect(rule).toMatch(/(^|\n)\s*appearance:\s*none !important;/);
        expect(rule).toMatch(/-webkit-appearance:\s*none !important;/);
        expect(rule).toMatch(/background-image:\s*var\(--xc-select-arrow\) !important;/);
        expect(rule).toMatch(/background-repeat:\s*no-repeat !important;/);
        expect(rule).toMatch(/padding-inline-end:\s*calc\([^;]+\) !important;/);
        // RTL puts the chevron at the other end.
        expect(ruleBody(tokensCss, `[dir='rtl'] ${ARROW_RULE}`)).toMatch(/background-position:\s*left /);
    });

    it('defines the arrow as the Network picker chevron in each palette muted color', () => {
        const chevron = renderedChevron();
        const lines = tokensCss.split('\n');
        const pairs = [];
        lines.forEach((line, index) => {
            const muted = /--xc-text-muted:\s*#([0-9A-Fa-f]{6});/.exec(line);
            if (!muted) return;
            const arrowLine = lines.slice(index + 1, index + 6).find((l) => l.includes('--xc-select-arrow:'));
            pairs.push({ muted: muted[1], arrowLine });
        });
        // Light, two dark, and three high-contrast palette blocks.
        expect(pairs).toHaveLength(6);
        for (const { muted, arrowLine } of pairs) {
            expect(arrowLine).toBeTruthy();
            expect(arrowLine).toContain(`stroke='%23${muted}'`);
            expect(arrowLine).toContain(`d='${chevron.d}'`);
            expect(arrowLine).toContain(`width='${chevron.width}'`);
            expect(arrowLine).toContain(`stroke-width='${chevron.strokeWidth}'`);
        }
        expect(tokensCss).toMatch(new RegExp(`background-size:\\s*${chevron.width}px ${chevron.width}px !important`));
    });

    it('gives every select the Network picker height, padding, border, radius and surface', () => {
        const base = ruleBody(tokensCss, ':where(select)');
        const picker = ruleBody(read('packages/core/src/ui/ChainPicker.module.css'), '.trigger');
        expect(base).not.toBeNull();
        expect(picker).not.toBeNull();

        const pickerBorder = /border:\s*(1px solid var\([^)]+\));/.exec(picker)?.[1];
        expect(pickerBorder).toBeTruthy();
        expect(base).toContain(`border: ${pickerBorder};`);
        expect(picker).toMatch(/background:\s*var\(--xc-surface\);/);
        expect(base).toMatch(/background-color:\s*var\(--xc-surface\);/);
        expect(picker).toMatch(/border-radius:\s*var\(--xc-control-radius\);/);
        expect(base).toMatch(/border-radius:\s*var\(--xc-control-radius\b/);
        // The picker publishes the md control height and padding tokens.
        const wrap = ruleBody(read('packages/core/src/ui/ChainPicker.module.css'), '.wrap');
        expect(wrap).toMatch(/--chain-picker-control-height:\s*var\(--xc-control-h-md\);/);
        expect(wrap).toMatch(/--chain-picker-padding-x:\s*var\(--xc-control-pad-x-md\b/);
        expect(base).toMatch(/height:\s*var\(--xc-control-h-md\b/);
        expect(base).toMatch(/padding-inline:\s*var\(--xc-control-pad-x-md\b/);
        expect(base).toMatch(/padding-block:\s*0;/);
    });

    it('keeps a visible focus ring and the platform arrow in forced colors', () => {
        expect(ruleBody(tokensCss, ':where(select):focus')).toMatch(/box-shadow:\s*0 0 0 3px var\(--xc-focus-ring\);/);
        const forced = /@media \(forced-colors: active\) \{[\s\S]*?\n\}/g;
        const blocks = tokensCss.match(forced) ?? [];
        const restores = blocks.some((block) => {
            const rule = ruleBody(block, ARROW_RULE);
            return rule && /appearance:\s*auto !important/.test(rule) && /background-image:\s*none !important/.test(rule);
        });
        expect(restores).toBe(true);
    });

    it('renders the shared Select as a plain dropdown the arrow rule matches', () => {
        render(
            <Select label="Sort" value="a" onChange={() => {}}>
                <option value="a">A to Z</option>
            </Select>,
        );
        const select = screen.getByRole('combobox', { name: 'Sort' });
        expect(select.tagName).toBe('SELECT');
        expect(select.matches(ARROW_RULE)).toBe(true);
    });

    it('leaves no native select on the browser arrow', () => {
        const offenders = [];
        for (const file of packageSources(/\.(jsx?|tsx?|mjs)$/)) {
            const text = readFileSync(file, 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/(^|[^:])\/\/.*$/gm, '$1');
            const rel = relative(root, file);
            // A list box (multiple or size) would fall outside the arrow rule.
            for (const tag of text.match(/<select\b[^>]*>/g) ?? []) {
                if (/\bmultiple\b|\bsize=/.test(tag)) offenders.push(`${rel}: ${tag}`);
            }
            if (/WebkitAppearance|\bappearance:\s*['"`](?:auto|menulist)/.test(text)) offenders.push(`${rel}: inline appearance`);
        }
        for (const file of packageSources(/\.css$/)) {
            const rel = relative(root, file);
            if (rel === join('packages', 'core', 'src', 'ui', 'tokens.css')) continue;
            // Rules aimed at a select (by element or by a select-named class)
            // must not put the browser arrow back.
            for (const [, selector, body] of readFileSync(file, 'utf8').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
                if (/select/i.test(selector) && /appearance:\s*(?:auto|menulist)/.test(body)) {
                    offenders.push(`${rel}: ${selector.trim()}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('draws the same chevron on the network filter', () => {
        const { d } = renderedChevron();
        const registry = { byCoin: (coin) => [{ id: `${coin}-mainnet`, displayName: coin }] };
        render(
            <NetworkFilter
                chainRegistry={registry}
                coinFamilies={['bitcoin']}
                value="all"
                onChange={() => {}}
                ariaLabel="Filter by network"
            />,
        );
        const trigger = screen.getByRole('button', { name: 'Filter by network' });
        expect(trigger.textContent).not.toMatch(/[▾▴]/);
        expect([...trigger.querySelectorAll('path')].map((p) => p.getAttribute('d'))).toContain(d);
    });
});
