// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import webAppSource from '../../packages/web/src/App.jsx?raw';
import webDexSource from '../../packages/web/src/surfaces/dex.jsx?raw';
import desktopAppSource from '../../packages/desktop/renderer/App.jsx?raw';
import extensionAppSource from '../../packages/extension/src/popup/App.jsx?raw';

const SHELLS = {
    web: webAppSource,
    desktop: desktopAppSource,
    extension: extensionAppSource,
};

function routeViews(source) {
    return [...source.matchAll(/unlockedView === '([^']+)'/g)].map((match) => match[1]);
}

function sharedRouteViews(name, source) {
    const views = new Set(routeViews(source));
    if (name === 'web') {
        for (const view of routeViews(webDexSource)) views.add(view);
        views.delete('menu');
        views.delete('alerts');
    }
    return [...views].sort();
}

function componentProps(source, component) {
    const match = source.match(new RegExp(`<${component}\\n([\\s\\S]*?)\\n\\s*/>`));
    expect(match, `${component} call site exists`).toBeTruthy();
    return new Set(
        [...match[1].matchAll(/^\s+([A-Za-z_$][\w$]*)=/gm)].map((prop) => prop[1]),
    );
}

describe('shell route parity', () => {
    it('keeps the shared unlocked view list aligned across all shells', () => {
        const desktopViews = sharedRouteViews('desktop', desktopAppSource);
        expect(desktopViews.length).toBeGreaterThan(100);
        expect(sharedRouteViews('extension', extensionAppSource)).toEqual(desktopViews);
        expect(sharedRouteViews('web', webAppSource)).toEqual(desktopViews);
    });

    it.each([
        ['Home', ['onResumeConfirm']],
        ['History', ['onReceive', 'onSelectEntry']],
        ['ManageToken', ['onViewActivity']],
        ['ContactsList', ['onOpenBackup']],
        ['ExecuteContractForm', ['initialMethod', 'initialParamsText']],
        ['Settings', ['onNavigateToMint']],
        ['TokenDetail', ['onBuy']],
    ])('wires shared %s actions in every shell', (component, callbacks) => {
        for (const [shell, source] of Object.entries(SHELLS)) {
            const props = componentProps(source, component);
            for (const callback of callbacks) {
                expect(props.has(callback), `${shell} ${component}.${callback}`).toBe(true);
            }
        }
    });

    it('carries desktop execute deep-link fields into its shared form', () => {
        expect(desktopAppSource).toContain(
            'if (route.executePrefill) setExecutePrefill(route.executePrefill);',
        );
    });
});
