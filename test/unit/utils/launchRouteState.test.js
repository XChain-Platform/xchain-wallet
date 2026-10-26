// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createLaunchRouteState, shouldClearTransientState } from '../../../packages/core/src/shared/utils/launchRouteState.js';

describe('createLaunchRouteState', () => {
    it('holds an incoming view until the session is unlocked', () => {
        const routes = createLaunchRouteState();

        routes.remember('receive', { state: 'locked' });
        expect(routes.shouldSkipLastViewResume()).toBe(true);
        expect(routes.takeForSession({ state: 'locked' })).toBeNull();
        expect(routes.takeForSession({ state: 'unlocked' })).toBe('receive');
        expect(routes.takeForSession({ state: 'unlocked' })).toBeNull();
    });

    it('treats an already unlocked string session as immediately handled', () => {
        const routes = createLaunchRouteState();
        routes.remember('send', { state: 'locked' });

        routes.remember('receive', 'unlocked');

        expect(routes.takeForSession({ state: 'unlocked' })).toBeNull();
        expect(routes.shouldSkipLastViewResume()).toBe(false);
    });

    it('keeps the last pending view and clears the resume guard after activation', () => {
        const routes = createLaunchRouteState();
        routes.remember('send');
        routes.remember('contract-execute');

        routes.walletActivated();

        expect(routes.shouldSkipLastViewResume()).toBe(false);
        expect(routes.takeForSession({ state: 'unlocked' })).toBe('contract-execute');
    });

    it('clears both pending state and the last-view guard', () => {
        const routes = createLaunchRouteState();
        routes.remember('send', { state: 'locked' });

        routes.clear();

        expect(routes.takeForSession({ state: 'unlocked' })).toBeNull();
        expect(routes.shouldSkipLastViewResume()).toBe(false);
    });
});

describe('shouldClearTransientState', () => {
    it('keeps a link parked while the shell loads or sits locked', () => {
        expect(shouldClearTransientState(undefined, 'loading')).toBe(false);
        expect(shouldClearTransientState('loading', 'locked')).toBe(false);
        expect(shouldClearTransientState('locked', 'locked')).toBe(false);
    });

    it('wipes when an unlocked session ends or the wallet is gone', () => {
        expect(shouldClearTransientState('unlocked', 'locked')).toBe(true);
        expect(shouldClearTransientState('unlocked', 'loading')).toBe(true);
        expect(shouldClearTransientState('locked', 'no-wallet')).toBe(true);
        expect(shouldClearTransientState('loading', 'error')).toBe(true);
    });

    it('never wipes on the way into an unlocked session', () => {
        expect(shouldClearTransientState('locked', 'unlocked')).toBe(false);
    });
});
