// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createLaunchRouteState } from '../../../packages/core/src/shared/utils/launchRouteState.js';

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
