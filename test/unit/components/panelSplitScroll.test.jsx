// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// G128: at the wide two-panel breakpoint a list-and-detail page scrolls each
// panel on its own, the headers stay put, and below it the page scrolls as one
// column. Vitest blanks CSS modules, so the layout contract is pinned on the
// sheets themselves; it was measured live in headless Chromium at 1280x800
// and 1920x1080 on 2026-11-16 (Home and the DEX: a wheel over the list moves
// only the list's scrollTop, the detail's top, the Screen body's scrollTop and
// window.scrollY stay put, and the reverse for the detail; at 411 the page
// scrolls as one column).

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ListDetailSplit } from '../../../packages/core/src/shared/components/PanelSplit.jsx';

const read = (path) => readFileSync(path, 'utf8');
const splitCss = read('packages/core/src/shared/components/PanelSplit.module.css');
const homeCss = read('packages/core/src/shared/components/HomeWideLayout.module.css');
const marketsCss = read('packages/core/src/shared/routes/MarketsList.module.css');

/** The body of the first rule whose selector is exactly `selector`. */
function rule(css, selector) {
    const match = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]='()*+]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : '';
}

afterEach(cleanup);

describe('the shared split CSS contract (PanelSplit.module.css)', () => {
    it('keeps the list header fixed while only the rows and detail scroll', () => {
        const listPanel = rule(splitCss, '.listPanel');
        expect(listPanel).toMatch(/display: flex;/);
        expect(listPanel).toMatch(/flex-direction: column;/);
        expect(listPanel).toMatch(/overflow: visible;/);
        expect(rule(splitCss, '.listHeader')).toMatch(/flex: none;/);
        const scrollers = rule(splitCss, '.listBody,\n.detailPanel');
        expect(scrollers).toMatch(/overflow-y: auto;/);
        expect(scrollers).toMatch(/overscroll-behavior: contain;/);
        expect(scrollers).toMatch(/min-height: 0;/);
        const listBody = rule(splitCss, '.listBody');
        expect(listBody).toMatch(/flex: 1 1 auto;/);
        expect(listBody).toMatch(/min-width: 0;/);
        const split = rule(splitCss, '.twoPanel');
        expect(split).toMatch(/flex: 1 1 auto;/);
        expect(split).toMatch(/min-height: 0;/);
        expect(split).toMatch(/align-items: stretch;/);
    });

    it('stops the Screen body scrolling and passes its height down to the split', () => {
        const body = rule(splitCss, '.twoPanelBody.twoPanelBody,\n.splitBody.splitBody');
        expect(body).toMatch(/display: flex;/);
        expect(body).toMatch(/flex-direction: column;/);
        expect(body).toMatch(/min-height: 0;/);
        expect(body).toMatch(/overflow-y: hidden;/);
        // A split that is the body's only block pays both insets itself; one
        // under other blocks keeps the top inset and pays only the bottom.
        expect(rule(splitCss, '.twoPanelBody.twoPanelBody.twoPanelBody')).toMatch(/padding-block: 0;/);
        expect(rule(splitCss, '.splitBody.splitBody.splitBody')).toMatch(/padding-block-end: 0;/);
        const fill = rule(splitCss, '.splitFill');
        expect(fill).toMatch(/flex: 1 1 auto;/);
        expect(fill).toMatch(/min-height: 0;/);
        // The other blocks in that chain keep their height; only the split gives.
        expect(rule(splitCss, ".splitFill > :not([class*='splitFill']):not([class*='twoPanel'])"))
            .toMatch(/flex-shrink: 0;/);
    });

    it('applies only while a host shows its split, never by a viewport query', () => {
        // Below the breakpoint no host mounts the split or sets these classes,
        // so the page scrolls as one column exactly as before.
        expect(splitCss).not.toMatch(/@media \((?:min|max)-width/);
    });

    it('rings a focused panel inside its own clip', () => {
        const ring = rule(splitCss, '.listBody:focus-visible,\n.detailPanel:focus-visible');
        expect(ring).toMatch(/outline: 2px solid var\(--xc-control-focus-ring\);/);
        expect(ring).toMatch(/outline-offset: -2px;/);
    });
});

describe('every list-and-detail split takes the shared contract', () => {
    it('wide Home composes the split, its panels and the fill chain', () => {
        expect(rule(homeCss, '.split')).toMatch(/composes: twoPanel from '\.\/PanelSplit\.module\.css';/);
        // (`.detailPanel` also closes the shared padding rule's selector list,
        // so these two read the rule that opens with the composition.)
        expect(homeCss).toMatch(/\n\.listPanel \{\s*composes: listPanel from '\.\/PanelSplit\.module\.css';/);
        expect(homeCss).toMatch(/\n\.listHeader \{\s*composes: listHeader from '\.\/PanelSplit\.module\.css';/);
        expect(homeCss).toMatch(/\n\.listBody \{\s*composes: listBody from '\.\/PanelSplit\.module\.css';/);
        expect(homeCss).toMatch(/\n\.detailPanel \{\s*composes: detailPanel from '\.\/PanelSplit\.module\.css';/);
        expect(rule(homeCss, '.wide')).toMatch(/composes: splitFill from '\.\/PanelSplit\.module\.css';/);
        // The overview and the divider keep their height; only the split gives.
        expect(rule(homeCss, '.top')).toMatch(/flex: none;/);
        expect(rule(homeCss, '.sectionDivider')).toMatch(/flex: none;/);
        // No script-set fill height that would beat the split's min-height 0.
        const homeJsx = read('packages/core/src/shared/components/HomeWideLayout.jsx');
        expect(homeJsx).not.toMatch(/useFillToContentEnd|minHeight/);
    });

    it('the DEX composes the same body, split and panels', () => {
        const from = "from '../components/PanelSplit.module.css';";
        expect(rule(marketsCss, '.twoPanelBody')).toContain(`composes: twoPanelBody ${from}`);
        expect(rule(marketsCss, '.twoPanel')).toContain(`composes: twoPanel ${from}`);
        expect(rule(marketsCss, '.listPanel')).toContain(`composes: listPanel ${from}`);
        expect(rule(marketsCss, '.listHeader')).toContain(`composes: listHeader ${from}`);
        expect(rule(marketsCss, '.listBody')).toContain(`composes: listBody ${from}`);
        expect(rule(marketsCss, '.marketPanel')).toContain(`composes: detailPanel ${from}`);
        const markets = read('packages/core/src/shared/routes/MarketsList.jsx');
        expect(markets).toMatch(/bodyClassName=\{showMarketPanel \? marketsStyles\.twoPanelBody : undefined\}/);
    });

    it('Staking stops its body scrolling only on the split branch', () => {
        const staking = read('packages/core/src/shared/routes/StakingList.jsx');
        expect(staking).toMatch(/bodyClassName=\{listDetailStyles\.twoPanelBody\}>\s*<ListDetailSplit/);
        expect(staking.match(/bodyClassName=/g)).toHaveLength(1);
    });
});

describe('ListDetailSplit panels', () => {
    it('are named scroll regions the keyboard can reach', () => {
        render(
            <ListDetailSplit
                storageKey="xc:testSplitWidth"
                resizeLabel="Resize the test list"
                layoutName="two-panel"
                listHeader={<p>fixed tools</p>}
                list={<p>rows</p>}
                listLabel="Test rows"
                detail={<p>detail</p>}
                detailLabel="Test detail"
            />,
        );
        const list = screen.getByRole('region', { name: 'Test rows' });
        const detail = screen.getByRole('region', { name: 'Test detail' });
        expect(list).toHaveTextContent('rows');
        expect(list).not.toHaveTextContent('fixed tools');
        expect(screen.getByText('fixed tools')).toBeInTheDocument();
        expect(list).toHaveAttribute('tabindex', '0');
        expect(detail).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('separator', { name: 'Resize the test list' })).toHaveAttribute('aria-controls', list.id);
    });
});
