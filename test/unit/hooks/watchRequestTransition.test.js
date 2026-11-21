// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { watchRequestTransition } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';

describe('watchRequestTransition', () => {
    it.each([
        ['preflighting', 'ready'],
        ['signing', 'ready'],
    ])('publishes when the phase enters ready from %s', (previousPhase, nextPhase) => {
        expect(watchRequestTransition(previousPhase, nextPhase)).toBe('publish');
    });

    it.each([
        ['ready', 'done'],
        ['ready', 'idle'],
        ['rechecking', 'error'],
        ['ready', 'signed-not-broadcast'],
    ])('withdraws when the phase leaves an open confirmation from %s to %s', (previousPhase, nextPhase) => {
        expect(watchRequestTransition(previousPhase, nextPhase)).toBe('withdraw');
    });

    it.each([
        ['ready', 'ready'],
        ['ready', 'signing'],
        ['idle', 'preflighting'],
        ['done', 'idle'],
    ])('does nothing for a transition from %s to %s', (previousPhase, nextPhase) => {
        expect(watchRequestTransition(previousPhase, nextPhase)).toBeNull();
    });
});
