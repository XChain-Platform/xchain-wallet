// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const readCore = (...parts) => readFileSync(
    join(root, 'packages', 'core', 'src', ...parts),
    'utf8',
);

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

function block(css, header) {
    const start = css.indexOf(header);
    const open = css.indexOf('{', start);
    if (start < 0 || open < 0) return '';
    let depth = 1;
    let cursor = open + 1;
    while (depth > 0 && cursor < css.length) {
        if (css[cursor] === '{') depth += 1;
        if (css[cursor] === '}') depth -= 1;
        cursor += 1;
    }
    return css.slice(open + 1, cursor - 1);
}

describe('large text layout styles', () => {
    it('defines shared type sizes in root-relative units', () => {
        const tokens = readCore('ui', 'tokens.css');
        const typeTokens = [...tokens.matchAll(/--xc-text-(?:xs|sm|md|lg|xl|2xl):\s*([^;]+);/g)]
            .map((match) => match[1]);

        expect(typeTokens).toHaveLength(6);
        expect(typeTokens.every((value) => /^\d*\.?\d+rem$/.test(value))).toBe(true);
    });

    it('keeps whole tab labels inside a scalable bar without fixed pixel type', () => {
        const css = readCore('shared', 'components', 'BottomTabBar.module.css');
        const bar = rule(css, '.bar');
        const tab = rule(css, '.tab');
        const label = rule(css, '.tabLabel');

        expect(css).not.toMatch(/font-size:\s*\d*\.?\d+px/);
        expect(bar).toMatch(/min-height:\s*3\.5rem/);
        expect(bar).not.toMatch(/(?:^|\s)height:/);
        expect(tab).toMatch(/min-width:\s*0/);
        expect(label).toMatch(/white-space:\s*normal/);
        expect(label).toMatch(/word-break:\s*normal/);
        expect(label).not.toMatch(/text-overflow|overflow:\s*hidden/);
    });

    it('keeps header titles bounded and network labels intact', () => {
        const appHeader = readCore('shared', 'components', 'AppHeader.module.css');
        const pageHeader = readCore('ui', 'PageHeader.module.css');
        const networkFilter = readCore('shared', 'components', 'NetworkFilter.module.css');

        expect(`${appHeader}\n${pageHeader}`)
            .not.toMatch(/font-size:\s*\d*\.?\d+px/);
        expect(rule(appHeader, '.left')).toMatch(/overflow:\s*hidden/);
        expect(rule(pageHeader, '.title')).toMatch(/overflow-wrap:\s*anywhere/);
        expect(rule(pageHeader, '.title')).toMatch(/white-space:\s*normal/);
        expect(rule(networkFilter, '.triggerLabel')).toMatch(/text-overflow:\s*ellipsis/);
    });

    it('wraps button labels while truncating balance names without icon shrinkage', () => {
        const button = readCore('ui', 'Button.module.css');
        const balances = readCore('shared', 'components', 'BalanceList.module.css');

        expect(rule(button, '.btn')).toMatch(/max-width:\s*100%/);
        expect(rule(button, '.btn')).toMatch(/overflow-wrap:\s*anywhere/);
        expect(rule(button, '.label')).toMatch(/white-space:\s*normal/);
        expect(rule(button, '.label')).not.toMatch(/text-overflow:\s*ellipsis/);
        expect(rule(balances, '.name')).toMatch(/text-overflow:\s*ellipsis/);
        expect(rule(balances, '.name')).toMatch(/min-width:\s*0/);
        expect(rule(balances, '.iconWrap')).toMatch(/flex:\s*0 0 auto/);
        expect(balances).not.toMatch(/font-size:\s*\d*\.?\d+px/);
    });

    it('reflows affected primary phone screens before scaled text crowds their rows', () => {
        const send = readCore('shared', 'routes', 'Send.module.css');
        const receive = readCore('shared', 'routes', 'Receive.module.css');
        const history = readCore('shared', 'routes', 'History.module.css');
        const settings = readCore('shared', 'routes', 'Settings.module.css');

        const sendPhone = block(send, '@media not all and (min-width: 480px)');
        expect(sendPhone).toMatch(/\.detailsList,[\s\S]*?\.advancedReviewList\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
        expect(sendPhone).toMatch(/\.successTxidRow,[\s\S]*?\.recipientRowHead\s*\{[^}]*flex-wrap:\s*wrap/);

        const receivePhone = block(receive, '@media (max-width: 480px)');
        expect(receivePhone).toMatch(/\.labelEditor\s*\{[^}]*grid-template-columns:\s*1fr/s);

        const historyPhone = block(history, '@media not all and (min-width: 480px)');
        expect(historyPhone).toMatch(/\.rowHeader,[\s\S]*?\.rowMeta\s*\{[^}]*flex-wrap:\s*wrap/);
        expect(historyPhone).toMatch(/\.detailsTable tbody\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
        expect(rule(history, '.resultsHeader')).toMatch(/flex-wrap:\s*wrap/);
        expect(rule(history, '.resultsHeader > div')).toMatch(/flex-wrap:\s*wrap/);

        const settingsPhone = block(settings, '@media (max-width: 480px)');
        expect(settingsPhone).toMatch(/\.page button\s*\{[^}]*max-width:\s*100%/s);
        expect(settingsPhone).toMatch(/\.drillRow\s*\{[^}]*flex-wrap:\s*wrap/s);
    });
});
