// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// One navigation history per shell: opening a page pushes it, Back pops it,
// redirects and finished forms replace or unwind, and lock, wallet switch
// and tab-bar roots start over. Back with nothing left lands on Home.

import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import {
    NAV_HISTORY_LIMIT,
    WALLET_SWITCH_KEEPS,
    createNavStack,
    landView,
    navItemKey,
    popView,
    pushItem,
    pushView,
    replaceView,
    retainViews,
    syncView,
    useNavHistory,
} from '../../../packages/core/src/ui/navHistory.js';

const views = (stack) => stack.map((entry) => entry.view);

describe('navigation history operations', () => {
    it('starts on Home, or on Home with the starting page above it', () => {
        expect(views(createNavStack())).toEqual(['home']);
        expect(views(createNavStack('settings'))).toEqual(['home', 'settings']);
    });

    it('pushes each opened page and keeps the left page item context on its entry', () => {
        let stack = createNavStack('settings');
        stack = pushView(stack, 'wallet-picker', { section: 'this-wallet' });
        stack = pushView(stack, 'wallet-details', null);
        expect(views(stack)).toEqual(['home', 'settings', 'wallet-picker', 'wallet-details']);
        expect(stack[1].ctx).toEqual({ section: 'this-wallet' });
    });

    it('does not stack the page already on screen twice', () => {
        const stack = pushView(createNavStack('history'), 'history', {});
        expect(views(stack)).toEqual(['home', 'history']);
    });

    it('treats opening Home as a fresh start', () => {
        const deep = pushView(pushView(createNavStack('settings'), 'wallet-picker'), 'wallet-details');
        expect(views(pushView(deep, 'home'))).toEqual(['home']);
    });

    it('pops to the page the user came from', () => {
        const stack = pushView(pushView(createNavStack('history'), 'action-detail'), 'token-detail');
        expect(views(popView(stack))).toEqual(['home', 'history', 'action-detail']);
    });

    it('falls back to Home when nothing is left to pop', () => {
        expect(views(popView([{ view: 'settings', ctx: null }]))).toEqual(['home']);
        const home = createNavStack();
        expect(popView(home)).toBe(home);
    });

    it('replaces the page on screen without adding a Back step', () => {
        const stack = replaceView(pushView(createNavStack('home'), 'scan'), 'send');
        expect(views(stack)).toEqual(['home', 'send']);
        expect(views(popView(stack))).toEqual(['home']);
    });

    it('collapses a replace onto the page just below instead of showing it twice', () => {
        const stack = pushView(createNavStack('lists'), 'list-share');
        expect(views(replaceView(stack, 'lists'))).toEqual(['home', 'lists']);
    });

    it('lands a finished form on a page it came through by unwinding to it', () => {
        let stack = createNavStack('settings');
        stack = pushView(stack, 'wallet-picker');
        stack = pushView(stack, 'wallet-details');
        stack = pushView(stack, 'wallet-rename', { walletDetailsId: 'w1' });
        const landed = landView(stack, 'wallet-details');
        expect(views(landed)).toEqual(['home', 'settings', 'wallet-picker', 'wallet-details']);
        expect(landed[3].ctx).toEqual({ walletDetailsId: 'w1' });
        expect(views(popView(landed))).not.toContain('wallet-rename');
    });

    it('lands a finished form on a page it did not come through by replacing the form', () => {
        const stack = pushView(pushView(createNavStack('home'), 'cosigner-accounts'), 'cosigner-provision');
        expect(views(landView(stack, 'cosigner-detail'))).toEqual(['home', 'cosigner-accounts', 'cosigner-detail']);
    });

    it('follows a browser Back as a pop and a browser Forward as a push', () => {
        const stack = pushView(createNavStack('history'), 'action-detail');
        expect(views(syncView(stack, 'history'))).toEqual(['home', 'history']);
        expect(views(syncView(stack, 'token-detail'))).toEqual(['home', 'history', 'action-detail', 'token-detail']);
        expect(syncView(stack, 'action-detail')).toBe(stack);
    });

    it('drops the old wallet pages on a wallet switch and keeps the wallet pages', () => {
        let stack = createNavStack('token-detail');
        stack = pushView(stack, 'settings');
        stack = pushView(stack, 'wallet-picker');
        stack = pushView(stack, 'wallet-details');
        const kept = retainViews(stack, (view) => WALLET_SWITCH_KEEPS.has(view));
        expect(views(kept)).toEqual(['home', 'settings', 'wallet-picker', 'wallet-details']);
        const fromToken = retainViews(pushView(createNavStack('token-detail'), 'manage-token'), (view) => WALLET_SWITCH_KEEPS.has(view));
        expect(views(fromToken)).toEqual(['home', 'manage-token']);
    });

    it('adds a step for the item left when another item opens on the same page', () => {
        const stack = pushItem(pushView(createNavStack('history'), 'token-detail', { q: 'x' }), { token: 'A' });
        expect(views(stack)).toEqual(['home', 'history', 'token-detail', 'token-detail']);
        expect(stack[2].ctx).toEqual({ token: 'A' });
        expect(stack[1].ctx).toEqual({ q: 'x' });
        const home = createNavStack();
        expect(pushItem(home, { token: 'A' })).toBe(home);
    });

    it('does not unwind to an earlier item of the page a form lands on when already there', () => {
        const stack = pushItem(pushView(createNavStack('history'), 'token-detail'), { token: 'A' });
        expect(landView(stack, 'token-detail')).toBe(stack);
    });

    it('names a detail page item by its identity fields only', () => {
        const a = { tokenDetailRef: { chainId: 'btc', kind: 'xchain', tick: 'AAA', quantity: '1', fiatRate: 2 } };
        const aLater = { tokenDetailRef: { chainId: 'btc', kind: 'xchain', tick: 'AAA', quantity: '5', fiatRate: 3 } };
        const b = { tokenDetailRef: { chainId: 'btc', kind: 'xchain', tick: 'BBB' } };
        expect(navItemKey('token-detail', a)).toBe(navItemKey('token-detail', aLater));
        expect(navItemKey('token-detail', a)).not.toBe(navItemKey('token-detail', b));
        // One token opened by a path that carries no kind is the same item.
        expect(navItemKey('token-detail', { tokenDetailRef: { chainId: 'btc', tick: 'AAA' } })).toBe(navItemKey('token-detail', a));
        expect(navItemKey('governance-poll-detail', { governanceRef: { chainId: 'btc', pollIndex: 7 } }))
            .toBe(navItemKey('governance-poll-detail', { governanceRef: { chainId: 'btc', pollIndex: '7' } }));
        expect(navItemKey('wallet-details', { walletDetailsId: 'w1' })).toBe('w1');
        expect(navItemKey('market', { activeMarket: { chainId: 'btc', tick1: 'A', tick2: 'B' } })).toBe('["btc","A","B"]');
        expect(navItemKey('token-detail', { tokenDetailRef: null })).toBeNull();
        expect(navItemKey('history', a)).toBeNull();
        expect(navItemKey('token-detail', null)).toBeNull();
    });

    it('keeps Home at the bottom when the history reaches its limit', () => {
        let stack = createNavStack();
        for (let i = 0; i < NAV_HISTORY_LIMIT + 10; i += 1) stack = pushView(stack, `page-${i}`);
        expect(stack).toHaveLength(NAV_HISTORY_LIMIT);
        expect(stack[0].view).toBe('home');
        expect(stack[stack.length - 1].view).toBe(`page-${NAV_HISTORY_LIMIT + 9}`);
    });
});

describe('useNavHistory', () => {
    it('pushes, pops, replaces and resets, with Home as the fallback', () => {
        const { result } = renderHook(() => useNavHistory());
        expect(result.current.view).toBe('home');
        act(() => result.current.navigate('settings'));
        act(() => result.current.navigate('wallet-picker'));
        expect(result.current.previousView).toBe('settings');
        act(() => result.current.back());
        expect(result.current.view).toBe('settings');
        act(() => result.current.replace('history'));
        expect(result.current.view).toBe('history');
        act(() => result.current.back());
        expect(result.current.view).toBe('home');
        act(() => result.current.back());
        expect(result.current.view).toBe('home');
        act(() => result.current.navigate('contacts'));
        act(() => result.current.reset('settings'));
        expect(result.current.depth).toBe(2);
        act(() => result.current.back());
        expect(result.current.view).toBe('home');
    });

    it('accepts a view updater like a state setter', () => {
        const { result } = renderHook(() => useNavHistory({ initialView: 'scan' }));
        act(() => result.current.navigate((view) => (view === 'scan' ? 'home' : view)));
        expect(result.current.view).toBe('home');
        expect(result.current.depth).toBe(1);
    });

    it('sees its own earlier calls inside one handler', () => {
        const { result } = renderHook(() => useNavHistory());
        act(() => {
            result.current.navigate('lists');
            result.current.navigate('list-fork');
            result.current.land('lists');
            result.current.navigate('access-lists');
        });
        expect(result.current.view).toBe('access-lists');
        act(() => result.current.back());
        expect(result.current.view).toBe('lists');
    });

    it('hands a returned-to page its item back after a later page reused the slot', () => {
        function TokenPages() {
            const [token, setToken] = useState('A');
            const nav = useNavHistory({
                capture: () => ({ token }),
                restore: (ctx) => setToken(ctx.token),
            });
            return (
                <>
                    <output>{`${nav.view}:${token}`}</output>
                    <button type="button" onClick={() => nav.navigate('token-detail')}>Open A</button>
                    <button type="button" onClick={() => nav.navigate('history')}>History</button>
                    <button type="button" onClick={() => { setToken('B'); nav.navigate('token-detail'); }}>Open B</button>
                    <button type="button" onClick={nav.back}>Back</button>
                </>
            );
        }
        render(<TokenPages />);
        fireEvent.click(screen.getByRole('button', { name: 'Open A' }));
        fireEvent.click(screen.getByRole('button', { name: 'History' }));
        fireEvent.click(screen.getByRole('button', { name: 'Open B' }));
        expect(screen.getByRole('status').textContent).toBe('token-detail:B');
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByRole('status').textContent).toBe('history:A');
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByRole('status').textContent).toBe('token-detail:A');
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByRole('status').textContent).toBe('home:A');
    });

    it('counts only a Back and a landing that unwound as Back steps', () => {
        const { result } = renderHook(() => useNavHistory());
        const backs = () => result.current.backs;
        act(() => result.current.navigate('settings'));
        act(() => result.current.navigate('wallet-picker'));
        act(() => result.current.navigate('wallet-details'));
        expect(backs()).toBe(0);
        act(() => result.current.back());
        expect(backs()).toBe(1);
        act(() => result.current.navigate('wallet-details'));
        act(() => result.current.navigate('wallet-rename'));
        act(() => result.current.land('wallet-details'));
        expect(backs()).toBe(2);
        // A form that lands on a page it did not come through replaces itself.
        act(() => result.current.navigate('cosigner-provision'));
        act(() => result.current.land('cosigner-detail'));
        act(() => result.current.replace('history'));
        act(() => result.current.sync('wallet-details'));
        expect(backs()).toBe(2);
        // Home and a tab root start the history over; neither is a Back.
        act(() => result.current.navigate('home'));
        act(() => result.current.navigate('contacts'));
        act(() => result.current.reset('settings'));
        expect(backs()).toBe(2);
        // Nothing to pop on Home adds no step.
        act(() => result.current.reset('home'));
        act(() => result.current.back());
        expect(backs()).toBe(2);
    });

    describe('another item on the same page', () => {
        // A token page that opens tokens the way the command palette does:
        // set the token, then open the page already on screen.
        function TokenPage() {
            const [token, setToken] = useState('A');
            const nav = useNavHistory({
                capture: () => ({ tokenDetailRef: { chainId: 'btc', kind: 'xchain', tick: token } }),
                restore: (ctx) => setToken(ctx.tokenDetailRef.tick),
                itemKey: navItemKey,
            });
            return (
                <>
                    <output>{`${nav.view}:${token}:${nav.depth}`}</output>
                    <button type="button" onClick={() => nav.navigate('token-detail')}>Open token page</button>
                    <button type="button" onClick={() => { setToken('B'); nav.navigate('token-detail'); }}>Open B</button>
                    <button type="button" onClick={() => { setToken('C'); nav.navigate('token-detail'); }}>Open C</button>
                    {/* A browser Back to an item names it through the route and syncs the page. */}
                    <button type="button" onClick={() => { setToken('A'); nav.sync('token-detail'); }}>Browser Back to A</button>
                    <button type="button" onClick={() => nav.navigate('history')}>History</button>
                    <button type="button" onClick={nav.back}>Back</button>
                </>
            );
        }

        const shown = () => screen.getByRole('status').textContent;
        const click = (name) => fireEvent.click(screen.getByRole('button', { name }));

        it('steps Back from token B to token A on the same page', () => {
            render(<TokenPage />);
            click('Open token page');
            expect(shown()).toBe('token-detail:A:2');
            click('Open B');
            expect(shown()).toBe('token-detail:B:3');
            click('Open C');
            expect(shown()).toBe('token-detail:C:4');
            click('Back');
            expect(shown()).toBe('token-detail:B:3');
            click('Back');
            expect(shown()).toBe('token-detail:A:2');
            click('Back');
            expect(shown()).toBe('home:A:1');
        });

        it('pops instead of pushing when the item shown is the one just below', () => {
            render(<TokenPage />);
            click('Open token page');
            click('Open B');
            expect(shown()).toBe('token-detail:B:3');
            click('Browser Back to A');
            expect(shown()).toBe('token-detail:A:2');
            click('Back');
            expect(shown()).toBe('home:A:1');
        });

        it('adds no step when Back restores an item or a page opens over it', () => {
            render(<TokenPage />);
            click('Open token page');
            click('Open B');
            click('History');
            expect(shown()).toBe('history:B:4');
            click('Back');
            expect(shown()).toBe('token-detail:B:3');
            click('Back');
            expect(shown()).toBe('token-detail:A:2');
        });

        it('leaves a history without an item key as it was', () => {
            const { result } = renderHook(() => {
                const [token, setToken] = useState('A');
                const nav = useNavHistory({ capture: () => ({ tokenDetailRef: { chainId: 'btc', tick: token } }) });
                return { nav, setToken };
            });
            act(() => result.current.nav.navigate('token-detail'));
            act(() => { result.current.setToken('B'); result.current.nav.navigate('token-detail'); });
            expect(result.current.nav.depth).toBe(2);
        });
    });

    it('pops only to the page directly below on a browser Back', () => {
        const { result } = renderHook(() => useNavHistory());
        act(() => result.current.navigate('settings'));
        act(() => result.current.navigate('wallet-picker'));
        expect(result.current.isPrevious('settings')).toBe(true);
        expect(result.current.isPrevious('home')).toBe(false);
        act(() => result.current.sync('settings'));
        expect(result.current.view).toBe('settings');
    });
});
