// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every shell walks one history. A Back that names its target would push it,
// so Back would ping-pong; a form that pushes its landing page leaves itself
// for Back to reopen. So Back props never navigate and landings only go Home.

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { describe, expect, it } from 'vitest';
import webAppSource from '../../packages/web/src/App.jsx?raw';
import webDexSource from '../../packages/web/src/surfaces/dex.jsx?raw';
import extensionAppSource from '../../packages/extension/src/popup/App.jsx?raw';
import desktopAppSource from '../../packages/desktop/renderer/App.jsx?raw';

const traverse = _traverse.default || _traverse;

const SOURCES = {
    web: webAppSource,
    'web dex surface': webDexSource,
    desktop: desktopAppSource,
    extension: extensionAppSource,
};

const BACK_PROPS = new Set(['onBack']);
const LANDING_PROPS = new Set(['onDone', 'onCreated', 'onRenamed', 'onSent', 'onPaired']);

/** Every setUnlockedView call inside a JSX prop of the given names, with its first argument. */
function navCallsInProps(source, props) {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const found = [];
    traverse(ast, {
        JSXAttribute(path) {
            const name = path.node.name?.name;
            if (!props.has(name)) return;
            path.traverse({
                CallExpression(call) {
                    const { callee } = call.node;
                    if (callee.type !== 'Identifier' || callee.name !== 'setUnlockedView') return;
                    const arg = call.node.arguments[0];
                    found.push({
                        prop: name,
                        line: call.node.loc?.start.line,
                        target: arg?.type === 'StringLiteral' ? arg.value : source.slice(arg?.start ?? 0, arg?.end ?? 0),
                    });
                },
            });
        },
    });
    return found;
}

describe.each(Object.entries(SOURCES))('%s Back walks the navigation history', (_name, source) => {
    it('has no Back handler that names its own target', () => {
        expect(navCallsInProps(source, BACK_PROPS)).toEqual([]);
    });

    it('lands every finished form by popping, unwinding or starting over on Home', () => {
        const pushes = navCallsInProps(source, LANDING_PROPS).filter((call) => call.target !== 'home');
        expect(pushes).toEqual([]);
    });

    it('keeps no per-page return mapping', () => {
        expect(source).not.toMatch(/\b\w*(ReturnView|BackTo|ReturnTo)\b/);
        expect(source).not.toMatch(/__from\b/);
        expect(source).not.toMatch(/stakeContractPickerActive/i);
    });
});

describe.each([
    ['web', webAppSource],
    ['desktop', desktopAppSource],
    ['extension', extensionAppSource],
])('%s shell history wiring', (_name, source) => {
    it('derives the view from the one history and pops it on Back', () => {
        expect(source).toContain('const nav = useNavHistory({');
        expect(source).toContain('const unlockedView = nav.view;');
        expect(source).toContain('const setUnlockedView = nav.navigate;');
        expect(source).toContain('const goBack = nav.back;');
        expect(source).not.toMatch(/const \[unlockedView, setUnlockedView\] = useState/);
    });

    it('starts the history over on lock and on a session read, and trims it on a wallet switch', () => {
        const clearState = source.slice(
            source.indexOf('function clearTransientActionState()'),
            source.indexOf('function handleLock()'),
        );
        expect(clearState).toContain("resetNav('home')");
        expect(source).toMatch(/const refresh = useCallback\([\s\S]*?resetNav\('home'\)/);
        expect(source).toContain('nav.retain((view) => WALLET_SWITCH_KEEPS.has(view))');
    });

    it('follows browser Back and Forward with the same history, and restarts it on a resume', () => {
        expect(source).toContain("onResume: (view, meta) => (meta?.source === 'history' ? nav.sync(view) : resetNav(view)),");
        expect(source).toMatch(/onHistoryPop: \(view\) => \{\s*if \(!nav\.isPrevious\(view\)\) return false;\s*goBack\(\);/);
    });

    // G06: every nav, menu, palette and go-to shortcut pick is a root, and
    // the outlet tells PageHeader whether the page on screen can go back.
    it('opens every nav, menu and palette pick as a root and hands canGoBack to the outlet', () => {
        expect(source).toContain('const openRootView = createRootViewOpener(nav.navigateRoot, () => {');
        expect(source).toMatch(/useCommandPalette\(\{[\s\S]{0,240}?navigate: openRootView,/);
        expect(source).toMatch(/useKeyboardShortcuts\(\{[\s\S]{0,400}?navigate: openRootView,/);
        expect(source).toMatch(/<ShellRouteOutlet[\s\S]{0,400}?canGoBack=\{nav\.canGoBack\}/);
        expect(source).not.toMatch(/TAB_BAR_DESTINATIONS\.includes/);
        const select = source.slice(
            source.search(/const handle(?:Menu|Shell|WalletMenu)Select = \(/),
            source.search(/const handle(?:Menu|Shell|WalletMenu)Select = \(/) + 3500,
        );
        expect(select).toMatch(/=== (?:unlockedView|view) && !nav\.canGoBack\)/);
        expect(select).toMatch(/palette\.navigate\(\w+\);\s*\};/);
    });

    it('trims the history on a wallet switch held for a review, as on a switch made here', () => {
        const at = source.indexOf('useHeldWalletSwitch((walletId');
        if (at === -1) return;
        const held = source.slice(at, source.indexOf('});', at));
        expect(held).toContain('if (walletId !== activeWalletId) nav.retain((view) => WALLET_SWITCH_KEEPS.has(view));');
    });

    it('steps through items on one page and keeps the browser history in step with Back', () => {
        expect(source).toContain('itemKey: navItemKey,');
        const lastView = source.slice(source.indexOf('useLastView({'), source.indexOf('onResumeParams:', source.indexOf('useLastView({')));
        expect(lastView).toContain('navBacks: nav.backs,');
    });

    it('keeps the Settings section on Settings own entry and puts it back on Back', () => {
        const ctx = source.slice(source.indexOf('navContext.current = {'), source.indexOf('// §24 / G055'));
        expect(ctx).toContain("settingsSection: unlockedView === 'settings' ? settingsSectionRef.current : null,");
        expect(ctx).toContain('setSettingsInitialSection(ctx.settingsSection ?? null);');
        expect(source).toMatch(/const setSettingsInitialSection = useCallback\(\(section\) => \{\s*settingsSectionRef\.current = section;/);
    });

    it('restores each page item context when Back returns to it', () => {
        const ctx = source.slice(source.indexOf('navContext.current = {'), source.indexOf('// §24 / G055'));
        for (const field of ['tokenDetailRef', 'walletDetailsId', 'accountDetailsId', 'addressDetailTarget', 'listRef', 'contractRef', 'formSource']) {
            expect(ctx).toContain(`${field},`);
            expect(ctx).toMatch(new RegExp(`set\\w+\\(ctx\\.${field}\\)`));
        }
    });
});
