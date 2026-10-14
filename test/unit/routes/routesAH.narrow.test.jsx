// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AccountPicker } from '../../../packages/core/src/shared/routes/AccountPicker.jsx';
import { ActionsMenu } from '../../../packages/core/src/shared/routes/ActionsMenu.jsx';
import { AddAccountForm } from '../../../packages/core/src/shared/routes/AddAccountForm.jsx';
import { AlertsRoute } from '../../../packages/core/src/shared/routes/AlertsRoute.jsx';
import { CoSignerAccountList } from '../../../packages/core/src/shared/routes/CoSignerAccountList.jsx';

const VIEWPORT_WIDTH = 320;
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const originalMatchMedia = window.matchMedia;
const alertsCss = readFileSync(
    'packages/core/src/shared/components/AlertsOverlay.module.css',
    'utf8',
);

function ruleBody(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] || '';
}

function queryMatches(query) {
    const minimum = /min-width:\s*(\d+)px/.exec(query);
    const maximum = /max-width:\s*(\d+)px/.exec(query);
    if (minimum) {
        const reachesMinimum = VIEWPORT_WIDTH >= Number(minimum[1]);
        if (query.includes('not all and')) return !reachesMinimum;
        if (!reachesMinimum) return false;
    }
    if (maximum && VIEWPORT_WIDTH > Number(maximum[1])) return false;
    return !query.includes('prefers-reduced-motion: reduce');
}

function matchMedia(query) {
    return {
        matches: queryMatches(query),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    };
}

function pixelLength(value) {
    const match = /^\s*(-?\d+(?:\.\d+)?)px\s*$/.exec(value || '');
    return match ? Number(match[1]) : null;
}

function expectFitsNarrowViewport(container) {
    const elements = [container, ...container.querySelectorAll('*')]
        .filter((element) => element instanceof HTMLElement);

    for (const element of elements) {
        const computed = window.getComputedStyle(element);
        for (const [source, value] of [
            ['inline width', element.style.width],
            ['inline min-width', element.style.minWidth],
            ['class width', computed.width],
            ['class min-width', computed.minWidth],
        ]) {
            const pixels = pixelLength(value);
            if (pixels !== null) {
                expect(pixels, `${source} on ${element.tagName}.${element.className}`)
                    .toBeLessThanOrEqual(VIEWPORT_WIDTH);
            }
        }
    }
}

function renderRoute(route, messaging = {}) {
    return render(
        <MessagingProvider
            shell="popup"
            messaging={{ getSettings: vi.fn().mockResolvedValue({}), ...messaging }}
        >
            {route}
        </MessagingProvider>,
    );
}

beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT_WIDTH });
    window.matchMedia = vi.fn(matchMedia);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

afterAll(() => {
    if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    else delete window.innerWidth;
    window.matchMedia = originalMatchMedia;
});

describe('A through H routes at 320px', () => {
    it('keeps AccountPicker within the viewport and exposes its primary action', async () => {
        const view = renderRoute(
            <AccountPicker
                walletId="wallet-1"
                activeAccountId="account-1"
                onSwitch={() => {}}
                onAddAccount={() => {}}
                onRenameAccount={() => {}}
                onBack={() => {}}
            />,
            {
                listAccounts: vi.fn().mockResolvedValue([{
                    id: 'account-1',
                    index: 0,
                    name: 'AccountWithAnUnbrokenNameThatMustRemainInsideTheNarrowViewport',
                }]),
            },
        );

        expect(await screen.findByRole('button', { name: 'Add account' })).toBeInTheDocument();
        expectFitsNarrowViewport(view.container);
    });

    it('keeps ActionsMenu within the viewport and exposes its primary action', () => {
        const view = renderRoute(
            <ActionsMenu
                entries={[{
                    id: 'publish',
                    group: 'publishing',
                    groupLabel: 'Publishing',
                    label: 'Publish an unusually descriptive action',
                    description: 'DescriptionWithoutAnyNaturalBreakPointsToStressTheShrinkLane',
                    onSelect: () => {},
                }]}
                onBack={() => {}}
            />,
        );

        expect(screen.getByRole('button', { name: /Publish an unusually descriptive action/ }))
            .toBeInTheDocument();
        expectFitsNarrowViewport(view.container);
    });

    it('keeps AddAccountForm within the viewport and exposes its primary action', () => {
        const view = renderRoute(
            <AddAccountForm walletId="wallet-1" onBack={() => {}} onCreated={() => {}} />,
            { listAccounts: vi.fn().mockResolvedValue([]) },
        );

        expect(screen.getByRole('button', { name: 'Add account' })).toBeInTheDocument();
        expectFitsNarrowViewport(view.container);
    });

    it('wraps alert content within the viewport and exposes its primary action', () => {
        const title = 'AlertTitleWithoutAnyNaturalBreakPointsThatCouldWidenTheCard';
        const message = 'AlertMessageWithoutAnyNaturalBreakPointsThatCouldWidenTheCard';
        const view = renderRoute(
            <AlertsRoute
                onBack={() => {}}
                alerts={[{
                    id: 'alert-1',
                    severity: 'warning',
                    title,
                    message,
                    action: { label: 'Review', onSelect: () => {} },
                }]}
            />,
        );

        expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument();
        expect(ruleBody(alertsCss, '.alert')).toMatch(/min-width:\s*0/);
        expect(ruleBody(alertsCss, '.alertHead')).toMatch(/min-width:\s*0/);
        expect(ruleBody(alertsCss, '.alertTitle'))
            .toMatch(/min-width:\s*0[\s\S]*overflow-wrap:\s*anywhere/);
        expect(ruleBody(alertsCss, '.alertMessage'))
            .toMatch(/min-width:\s*0[\s\S]*overflow-wrap:\s*anywhere/);
        expectFitsNarrowViewport(view.container);
    });

    it('keeps CoSignerAccountList within the viewport and exposes its primary action', async () => {
        const view = renderRoute(
            <CoSignerAccountList
                walletId="wallet-1"
                onBack={() => {}}
                onProvision={() => {}}
                onOpen={() => {}}
            />,
            { listCoSignerAccounts: vi.fn().mockResolvedValue([]) },
        );

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'New agent account' })).toBeInTheDocument();
        });
        expectFitsNarrowViewport(view.container);
    });
});
