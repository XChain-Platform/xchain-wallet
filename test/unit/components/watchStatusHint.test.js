// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { watchStatusHint } from '../../../packages/core/src/shared/components/settings/WatchStatusRows.jsx';

describe('watchStatusHint', () => {
    it('pairs an unpaired iOS watch first', () => {
        expect(watchStatusHint({ paired: false, installed: false, reachable: false }, 'ios'))
            .toBe('pairWatchIos');
    });

    it('installs the iOS app after pairing', () => {
        expect(watchStatusHint({ paired: true, installed: false, reachable: false }, 'ios'))
            .toBe('installWatchIos');
    });

    it('installs the Android app when no Wear node is visible', () => {
        expect(watchStatusHint({ paired: false, installed: false, reachable: false }, 'android'))
            .toBe('installWatchAndroid');
    });

    it('brings an installed watch near when it is unreachable', () => {
        expect(watchStatusHint({ paired: true, installed: true, reachable: false }, 'android'))
            .toBe('bringWatchNear');
    });

    it('has no next step for a reachable watch', () => {
        expect(watchStatusHint({ paired: true, installed: true, reachable: true }, 'ios'))
            .toBeNull();
    });

    it('has no next step for an unknown platform', () => {
        expect(watchStatusHint({ paired: false, installed: false, reachable: false }, 'web'))
            .toBeNull();
    });
});
