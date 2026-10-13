// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ActionIntentSummary } from '../../../packages/core/src/shared/components/ActionIntentSummary.jsx';
import { BackupReminderCard } from '../../../packages/core/src/shared/components/BackupReminderCard.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { CollectiblesView } from '../../../packages/core/src/shared/components/CollectiblesView.jsx';
import { DerivationPathCrossCheck } from '../../../packages/core/src/shared/components/DerivationPathCrossCheck.jsx';
import { HomeFilterBar } from '../../../packages/core/src/shared/components/HomeFilterBar.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';

const VIEWPORT_WIDTH = 320;
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');

const css = Object.fromEntries([
    'actionIntent',
    'backupReminder',
    'bottomTabs',
    'collectibles',
    'derivation',
    'homeFilter',
    'networkSelect',
].map((key) => {
    const files = {
        actionIntent: 'ActionIntentSummary.module.css',
        backupReminder: 'BackupReminderCard.module.css',
        bottomTabs: 'BottomTabBar.module.css',
        collectibles: 'CollectiblesView.module.css',
        derivation: 'DerivationPathCrossCheck.module.css',
        homeFilter: 'HomeFilterBar.module.css',
        networkSelect: 'NetworkFilter.module.css',
    };
    return [
        key,
        readFileSync(`packages/core/src/shared/components/${files[key]}`, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, ''),
    ];
}));

function ruleBody(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

function mediaBlock(text, query) {
    const start = text.indexOf(`@media ${query}`);
    if (start < 0) return '';
    const open = text.indexOf('{', start);
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
        if (text[index] === '{') depth += 1;
        if (text[index] === '}') depth -= 1;
        if (depth === 0) return text.slice(open + 1, index);
    }
    return '';
}

function expectNoFixedWidthBeyondViewport(...stylesheets) {
    const widths = stylesheets.flatMap((text) => [...text.matchAll(
        /(?:^|[;{])\s*(?:min-|max-)?width\s*:\s*(\d+(?:\.\d+)?)px\b/g,
    )].map((match) => Number(match[1])));
    expect(widths.filter((width) => width > VIEWPORT_WIDTH)).toEqual([]);
}

function renderNarrow(ui) {
    return render(
        <div data-testid="narrow-viewport" style={{ width: `${VIEWPORT_WIDTH}px`, maxWidth: '100%' }}>
            {ui}
        </div>,
    );
}

beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT_WIDTH });
});

beforeEach(() => {
    globalThis.localStorage.clear();
});

afterEach(() => cleanup());

afterAll(() => {
    if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    else delete window.innerWidth;
});

describe('shared components at a 320px viewport', () => {
    it('stacks ActionIntentSummary rows without clipping their labels', () => {
        const label = 'Recipient wallet address';
        renderNarrow(
            <ActionIntentSummary
                decoded={{
                    summary: 'Send tokens to the selected recipient',
                    details: [{ label, value: 'bc1qexampledestination' }],
                    warnings: [],
                }}
                simulation={null}
            />,
        );

        expect(screen.getByText(label)).toHaveTextContent(label);
        const narrow = mediaBlock(css.actionIntent, 'not all and (min-width: 400px)');
        expect(narrow).toMatch(/\.row,\s*\.delta\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
        expect(ruleBody(css.actionIntent, '.row dt')).not.toMatch(/text-overflow|white-space:\s*nowrap/);
        expectNoFixedWidthBeyondViewport(css.actionIntent);
    });

    it('wraps the BackupReminderCard body and actions inside the viewport', async () => {
        renderNarrow(
            <BackupReminderCard
                walletId="narrow-wallet"
                hasFunds
                onAction={() => {}}
            />,
        );

        expect(await screen.findByRole('region', { name: 'Back up your wallet' }))
            .toHaveTextContent('Save your recovery phrase or export an encrypted backup');
        expect(screen.getByRole('button', { name: 'Back up now' })).toBeInTheDocument();
        expect(ruleBody(css.backupReminder, '.card')).toMatch(/flex-wrap:\s*wrap/);
        expect(ruleBody(css.backupReminder, '.body')).toMatch(/min-width:\s*0/);
        expectNoFixedWidthBeyondViewport(css.backupReminder);
    });

    it('renders every BottomTabBar label without ellipsis', () => {
        renderNarrow(<BottomTabBar currentView="home" onSelect={() => {}} />);

        for (const label of ['Home', 'History', 'Send', 'Scan', 'More']) {
            expect(screen.getByRole('button', { name: label })).toHaveTextContent(label);
        }
        const labelRule = ruleBody(css.bottomTabs, '.tabLabel');
        expect(labelRule).toMatch(/white-space:\s*normal/);
        expect(labelRule).toMatch(/word-break:\s*normal/);
        expect(labelRule).not.toMatch(/text-overflow|overflow:\s*hidden/);
        expectNoFixedWidthBeyondViewport(css.bottomTabs);
    });

    it('keeps a complete multi-line CollectiblesView card name', () => {
        const displayName = 'Limited edition collectible from the northern lights collection';
        renderNarrow(
            <MessagingContext.Provider value={{ shell: 'web', messaging: {} }}>
                <CollectiblesView
                    rows={[{
                        chainId: 'bitcoin-mainnet',
                        tick: 'AURORA',
                        kind: 'token',
                        displayName,
                        divisibility: 0,
                        fiatRate: null,
                        quantity: '1',
                    }]}
                    allowRemoteImages={false}
                />
            </MessagingContext.Provider>,
        );

        expect(screen.getByTitle(displayName)).toHaveTextContent(displayName);
        const nameRule = ruleBody(css.collectibles, '.name');
        expect(nameRule).toMatch(/overflow-wrap:\s*break-word/);
        expect(nameRule).toMatch(/word-break:\s*normal/);
        expect(nameRule).not.toMatch(/line-clamp|text-overflow|overflow:\s*hidden/);
        expectNoFixedWidthBeyondViewport(css.collectibles);
    });

    it('preserves DerivationPathCrossCheck labels and shrinkable values', () => {
        const path = "m/84'/0'/123456'/0/123456";
        renderNarrow(
            <DerivationPathCrossCheck
                signerName="Ledger hardware wallet for long term savings"
                signerKind="ledger"
                path={path}
                address="bc1qexampleaddresswithmanycharacters123456789"
            />,
        );

        expect(screen.getByText('Derivation path')).toHaveTextContent('Derivation path');
        expect(screen.getByText(path)).toHaveTextContent(path);
        expect(ruleBody(css.derivation, '.grid')).toMatch(/grid-template-columns:\s*auto 1fr/);
        expect(ruleBody(css.derivation, '.value')).toMatch(/word-break:\s*break-word/);
        expect(ruleBody(css.derivation, '.label')).not.toMatch(/text-overflow|white-space:\s*nowrap/);
        expectNoFixedWidthBeyondViewport(css.derivation);
    });

    it('stacks HomeFilterBar controls and preserves the selected network label', () => {
        const networkLabel = 'Bitcoin Cash Test Network';
        const chainRegistry = {
            byCoin: () => [{ id: 'bitcoin-testnet', displayName: networkLabel }],
        };
        renderNarrow(
            <HomeFilterBar
                chainRegistry={chainRegistry}
                coinFamilies={['bitcoin']}
                networkFilter="bitcoin"
                onNetworkFilterChange={() => {}}
                tokenQuery=""
                onTokenQueryChange={() => {}}
            />,
        );

        expect(screen.getByRole('button', { name: 'Filter by network' }))
            .toHaveTextContent(networkLabel);
        const narrow = mediaBlock(css.homeFilter, '(max-width: 360px)');
        expect(ruleBody(narrow, '.bar')).toMatch(/flex-wrap:\s*wrap/);
        expect(ruleBody(narrow, '.searchWrap,\n    .networkWrap')).toMatch(/flex-basis:\s*100%/);
        const labelRule = ruleBody(css.networkSelect, '.triggerLabel');
        expect(labelRule).toMatch(/text-overflow:\s*ellipsis/);
        expectNoFixedWidthBeyondViewport(css.homeFilter, css.networkSelect);
    });
});
