// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { nativeNotificationPermission } from '../../../packages/core/src/shared/components/settings/NotificationsSection.jsx';

describe('nativeNotificationPermission', () => {
    it.each([
        ['granted', 'granted'],
        ['denied', 'denied'],
        ['default', 'default'],
        ['prompt', 'default'],
        ['prompt-with-rationale', 'default'],
    ])('maps %s to %s', (state, expected) => {
        expect(nativeNotificationPermission(state)).toBe(expected);
    });

    it.each([
        ['an absent state', undefined],
        ['a non-string state', 1],
        ['an unknown state', 'unknown'],
    ])('maps %s to unsupported', (_label, state) => {
        expect(nativeNotificationPermission(state)).toBe('unsupported');
    });
});
