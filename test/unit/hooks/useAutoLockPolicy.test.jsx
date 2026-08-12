// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// useAutoLockPolicy. The defect these tests pin down is a MOUNT
// POINT, not a timer bug: `useAutoLock` cancels its pending timeout in the
// effect cleanup, so whichever component calls it decides how long auto-lock
// survives. It used to be called from Home.jsx, and the shells render exactly
// one route at a time, so navigating to Send / Receive / History / Settings
// unmounted Home and silently disarmed auto-lock for the rest of the session.
//
// The first test therefore renders a miniature shell with a view switch and
// navigates AWAY from home before the idle window elapses. The second test
// renders the old route-level shape against the same clock and asserts it
// fails, so the suite proves it can actually see the regression rather than
// passing for free.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useState } from 'react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import {
    useAutoLockPolicy, resolveAutoLockMinutes, AUTO_LOCK_SHELLS,
} from '../../../packages/core/src/shared/hooks/useAutoLockPolicy.js';
import { useAutoLock } from '../../../packages/core/src/shared/hooks/useAutoLock.js';
import {
    AUTOLOCK_MINUTES_DEFAULT, AUTOLOCK_MINUTES_MAX, AUTOLOCK_NEVER,
} from '../../../packages/core/src/schemas/settings.js';

const MINUTE = 60 * 1000;

function makeMessaging({ autolockMinutes = 1, reportAutoLock } = {}) {
    return {
        lockWallet: vi.fn(async () => ({ locked: true })),
        getSettings: vi.fn(async () => ({ schemaVersion: 2, autolockMinutes })),
        updateSettings: vi.fn(async (p) => p),
        ...(reportAutoLock ? { reportAutoLock } : {}),
    };
}

// A miniature shell: one auto-lock call above a view switch, exactly the
// shape each real AppInner uses.
function Shell({ messaging, shell = 'web', activeWalletId = 'w1', onLocked, initialView = 'home' }) {
    const [view, setView] = useState(initialView);
    const [sessionState, setSessionState] = useState('unlocked');
    useAutoLockPolicy({
        sessionState,
        activeWalletId,
        onLocked: () => { setSessionState('locked'); onLocked?.(); },
    });
    if (sessionState === 'locked') return <div data-testid="view">locked</div>;
    return (
        <div>
            <div data-testid="view">{view}</div>
            <button type="button" data-testid="go-send" onClick={() => setView('send')}>send</button>
        </div>
    );
}

// The pre-shape: auto-lock wired INSIDE the route that unmounts.
function RouteWithAutoLock({ onLock, idleMs }) {
    useAutoLock(onLock, { idleMs, enabled: true });
    return <div>home</div>;
}
function LegacyShell({ onLock, idleMs }) {
    const [view, setView] = useState('home');
    return (
        <div>
            {view === 'home' ? <RouteWithAutoLock onLock={onLock} idleMs={idleMs} /> : <div>send</div>}
            <button type="button" data-testid="go-send" onClick={() => setView('send')}>send</button>
        </div>
    );
}

function renderShell(ui, { messaging, shell = 'web' }) {
    return render(
        <MessagingContext.Provider value={{ shell, messaging }}>
            {ui}
        </MessagingContext.Provider>,
    );
}

// useSettings loads its record in an effect; flush that microtask + the
// resulting re-render before the clock starts moving.
async function settle() {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

// Advance the fake clock in tick-sized steps so useAutoLock's chained
// setTimeout loop actually runs; a single big jump would only fire the one
// timeout that is currently scheduled.
async function idleFor(ms, step = 30 * 1000) {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
        await act(async () => { await vi.advanceTimersByTimeAsync(step); });
    }
}

describe('resolveAutoLockMinutes', () => {
    it('keeps 0 as the explicit "Never" choice', () => {
        expect(resolveAutoLockMinutes(0)).toBe(AUTOLOCK_NEVER);
    });

    it('falls back to the schema default for a missing or junk value, never to "off"', () => {
        // null and '' matter most here: a bare Number() coerces both to 0,
        // which would read a missing field as "Never" and disable auto-lock.
        for (const raw of [undefined, null, '', ' ', 'nope', {}, [], NaN, -5, Infinity]) {
            expect(resolveAutoLockMinutes(raw)).toBe(AUTOLOCK_MINUTES_DEFAULT);
        }
    });

    it('clamps a hand-edited record into range instead of disabling the timer', () => {
        expect(resolveAutoLockMinutes(99999)).toBe(AUTOLOCK_MINUTES_MAX);
        // Sub-minute values land on the floor rather than rounding down into
        // the "Never" sentinel.
        expect(resolveAutoLockMinutes(0.4)).toBe(1);
    });

    it('passes the UI-offered values through untouched', () => {
        for (const m of [1, 5, 15, 30, 60, 240]) expect(resolveAutoLockMinutes(m)).toBe(m);
    });
});

describe('useAutoLockPolicy', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); cleanup(); vi.restoreAllMocks(); });

    it('arms for every foreground shell', () => {
        expect([...AUTO_LOCK_SHELLS].sort()).toEqual(['desktop', 'popup', 'web']);
    });

    it('Still locks after the user navigates off Home', async () => {
        const messaging = makeMessaging({ autolockMinutes: 1 });
        const { getByTestId } = renderShell(<Shell messaging={messaging} />, { messaging });
        await settle();

        // Navigate away well inside the idle window; the old wiring cancelled
        // the timer right here.
        await act(async () => { getByTestId('go-send').click(); });
        expect(getByTestId('view').textContent).toBe('send');
        // The click counts as activity, so the full minute runs from now.
        await idleFor(1.5 * MINUTE);

        expect(messaging.lockWallet).toHaveBeenCalledTimes(1);
        expect(getByTestId('view').textContent).toBe('locked');
    });

    it('the pre-fix route-level wiring fails the same check (the test can see the bug)', async () => {
        const onLock = vi.fn();
        const { getByTestId } = render(<LegacyShell onLock={onLock} idleMs={MINUTE} />);
        await act(async () => { getByTestId('go-send').click(); });
        await idleFor(3 * MINUTE);
        expect(onLock).not.toHaveBeenCalled();
    });

    it('locks on an idle Home too (the case that already worked stays working)', async () => {
        const messaging = makeMessaging({ autolockMinutes: 1 });
        const { getByTestId } = renderShell(<Shell messaging={messaging} />, { messaging });
        await settle();
        await idleFor(1.5 * MINUTE);
        expect(messaging.lockWallet).toHaveBeenCalledTimes(1);
        expect(getByTestId('view').textContent).toBe('locked');
    });

    it('honours the configured timeout instead of a hard-coded fallback', async () => {
        // Regression on the old `Number(settings?.autolockMinutes)` read: that
        // hit the useSettings WRAPPER, always came back undefined, and pinned
        // every wallet to the fallback no matter what Settings said.
        const messaging = makeMessaging({ autolockMinutes: 30 });
        renderShell(<Shell messaging={messaging} />, { messaging });
        await settle();

        await idleFor(10 * MINUTE);
        expect(messaging.lockWallet).not.toHaveBeenCalled();
        await idleFor(21 * MINUTE);
        expect(messaging.lockWallet).toHaveBeenCalledTimes(1);
    });

    it('never locks when the user picked "Never"', async () => {
        const messaging = makeMessaging({ autolockMinutes: 0 });
        renderShell(<Shell messaging={messaging} />, { messaging });
        await settle();
        await idleFor(3 * AUTOLOCK_MINUTES_DEFAULT * MINUTE);
        expect(messaging.lockWallet).not.toHaveBeenCalled();
    });

    it('never locks a demo wallet out of its unrecoverable session password', async () => {
        const messaging = makeMessaging({ autolockMinutes: 1 });
        window.localStorage.setItem('xc:demoWalletId', 'demo-1');
        renderShell(<Shell messaging={messaging} activeWalletId="demo-1" />, { messaging });
        await settle();
        await idleFor(5 * MINUTE);
        expect(messaging.lockWallet).not.toHaveBeenCalled();
        window.localStorage.removeItem('xc:demoWalletId');
    });

    it('user activity keeps pushing the deadline out', async () => {
        const messaging = makeMessaging({ autolockMinutes: 1 });
        renderShell(<Shell messaging={messaging} />, { messaging });
        await settle();
        for (let i = 0; i < 6; i += 1) {
            await idleFor(30 * 1000);
            await act(async () => { window.dispatchEvent(new Event('keydown')); });
        }
        expect(messaging.lockWallet).not.toHaveBeenCalled();
        await idleFor(1.5 * MINUTE);
        expect(messaging.lockWallet).toHaveBeenCalledTimes(1);
    });

    it('does not arm while the session is locked', async () => {
        const messaging = makeMessaging({ autolockMinutes: 1 });
        function LockedShell() {
            useAutoLockPolicy({ sessionState: 'locked', activeWalletId: 'w1' });
            return <div />;
        }
        renderShell(<LockedShell />, { messaging });
        await settle();
        await idleFor(5 * MINUTE);
        expect(messaging.lockWallet).not.toHaveBeenCalled();
    });

    it('retries rather than giving up when the lock round-trip fails', async () => {
        const messaging = makeMessaging({ autolockMinutes: 1 });
        messaging.lockWallet = vi.fn(async () => { throw new Error('host offline'); });
        renderShell(<Shell messaging={messaging} />, { messaging });
        await settle();
        await idleFor(1.5 * MINUTE);
        expect(messaging.lockWallet).toHaveBeenCalledTimes(1);
        // A failed lock must not leave the session unlocked with no timer.
        await idleFor(1.5 * MINUTE);
        expect(messaging.lockWallet.mock.calls.length).toBeGreaterThan(1);
    });

    it('reports the arm decision to the extension service-worker backstop', async () => {
        const reportAutoLock = vi.fn(async () => ({ ok: true }));
        const messaging = makeMessaging({ autolockMinutes: 5, reportAutoLock });
        renderShell(<Shell messaging={messaging} />, { messaging, shell: 'popup' });
        await settle();
        expect(reportAutoLock).toHaveBeenCalledWith({ armed: true, idleMs: 5 * MINUTE });
    });

    it('withholds a premature disarm while the session status is still resolving', async () => {
        const reportAutoLock = vi.fn(async () => ({ ok: true }));
        const messaging = makeMessaging({ autolockMinutes: 5, reportAutoLock });
        function BootingShell() {
            useAutoLockPolicy({ sessionState: 'loading', activeWalletId: 'w1' });
            return <div />;
        }
        renderShell(<BootingShell />, { messaging, shell: 'popup' });
        await settle();
        expect(reportAutoLock).not.toHaveBeenCalled();
    });

    it('does not arm in a shell with no foreground event loop', async () => {
        const messaging = makeMessaging({ autolockMinutes: 1 });
        renderShell(<Shell messaging={messaging} />, { messaging, shell: 'headless' });
        await settle();
        await idleFor(5 * MINUTE);
        expect(messaging.lockWallet).not.toHaveBeenCalled();
    });
});
