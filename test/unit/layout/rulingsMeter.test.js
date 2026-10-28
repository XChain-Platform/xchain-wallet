// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createElement as h } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { measureRulings } from '../../e2e/layout/sweep.js';
import { EmptyState } from '../../../packages/core/src/ui/EmptyState.jsx';
import { EmptyStateAsLineContext } from '../../../packages/core/src/ui/Screen.jsx';
import { StatusMessage } from '../../../packages/core/src/ui/StatusMessage.jsx';
import { StalenessLabel } from '../../../packages/core/src/shared/components/StalenessLabel.jsx';

const CONTENT_WIDTH = 360;

/**
 * Renders `children` into a #xc-main page and lays each top-level child out
 * as one 40px band below the last, so the meter sees the page in order.
 */
function layOutPage(...children) {
    const main = document.createElement('main');
    main.id = 'xc-main';
    document.body.appendChild(main);
    render(h('div', null, ...children), { container: main });
    Object.defineProperty(main, 'clientWidth', { value: CONTENT_WIDTH });
    main.getBoundingClientRect = () => ({ left: 0, top: 0, width: CONTENT_WIDTH, height: 800, right: CONTENT_WIDTH, bottom: 800 });
    const page = main.firstElementChild;
    page.getBoundingClientRect = main.getBoundingClientRect;
    [...page.children].forEach((band, i) => {
        const box = { left: 0, top: i * 50, width: CONTENT_WIDTH, height: 40, right: CONTENT_WIDTH, bottom: i * 50 + 40 };
        for (const el of [band, ...band.querySelectorAll('*')]) {
            el.style.opacity = '1';
            el.getBoundingClientRect = () => box;
        }
    });
    return main;
}

afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
});

describe('UI rulings meter', () => {
    it('keeps StatusMessage notices out of the U16 card checks', () => {
        document.body.innerHTML = `
            <main>
                <div data-variant="warning" class="StatusMessage_row StatusMessage_warning"
                    style="border: 2px solid rgb(180, 120, 0); border-radius: 6px; opacity: 1">
                    Static demo notice
                    <span style="border: 1px dashed rgb(180, 120, 0); opacity: 1">Notice detail</span>
                </div>
                <div role="status"
                    style="border: 2px solid rgb(0, 90, 180); border-radius: 6px; opacity: 1">Status notice</div>
                <div role="alert"
                    style="border: 2px solid rgb(180, 0, 0); border-radius: 6px; opacity: 1">Alert notice</div>
                <div id="off-token-card"
                    style="border: 2px solid rgb(0, 0, 0); border-radius: 9px; opacity: 1">Plain content</div>
            </main>
        `;
        const box = { left: 0, top: 0, width: 180, height: 60, right: 180, bottom: 60 };
        for (const element of document.querySelectorAll('body *')) {
            element.getBoundingClientRect = () => box;
        }

        const measured = measureRulings();

        expect(measured.offTokenCards).toEqual([
            expect.objectContaining({ el: 'div "Plain content"' }),
        ]);
        expect(measured.dashedBorders).toBeUndefined();
    });

    it('places notices first but lets an empty state stand where its list would be', () => {
        layOutPage(
            h('h2', null, 'Lists'),
            h('button', { type: 'button' }, 'New list'),
            h(EmptyState, { title: 'No lists yet', body: 'Create an address list to reuse it.' }),
            h(StatusMessage, { variant: 'warning' }, 'Some lists could not load'),
        );

        const placed = measureRulings().noticePlacement || [];

        expect(placed).toEqual([
            expect.objectContaining({ el: expect.stringContaining('Some lists could not load'), contentAbove: true }),
        ]);
    });

    it('reads a freshness label as part of the data it dates, not as a notice', () => {
        layOutPage(
            h('h2', null, 'Total balance'),
            h(StalenessLabel, { lastSyncedAt: Date.now() }),
            h(StatusMessage, { variant: 'info' }, 'Balances refresh every minute'),
        );

        const placed = measureRulings().noticePlacement || [];

        expect(placed).toEqual([
            expect.objectContaining({ el: expect.stringContaining('Balances refresh every minute'), contentAbove: true }),
        ]);
    });

    it('marks every empty state for the meter, a section line included', () => {
        const { container } = render(h('div', null,
            h(EmptyState, { title: 'No published contracts' }),
            h(EmptyStateAsLineContext.Provider, { value: true },
                h(EmptyState, { title: 'No contract interactions' }))));

        const marked = container.querySelectorAll('[data-xc-empty-state]');
        expect(marked).toHaveLength(2);
        // The second is drawn as a section line, not a page message.
        expect(marked[1].hasAttribute('data-empty-state')).toBe(false);
    });
});
