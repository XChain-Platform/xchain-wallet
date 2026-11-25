// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    AUTHORABLE_ACTIONS,
    CHAIN_GATED_ACTIONS,
} from '../../../packages/core/src/registry/actions.js';
import {
    SIGN_ACTION_ENABLED,
    SIGN_ACTION_REFUSED,
    isSignActionEnabled,
} from '../../../packages/extension/src/bridge/signActionEnabled.js';

describe('bridge.signAction enabled action coverage', () => {
    it('partitions every authorable action exactly once', () => {
        const refusedActions = Object.keys(SIGN_ACTION_REFUSED);

        for (const action of AUTHORABLE_ACTIONS) {
            const memberships = Number(SIGN_ACTION_ENABLED.includes(action))
                + Number(refusedActions.includes(action));
            expect(memberships, action).toBe(1);
        }

        expect(SIGN_ACTION_ENABLED.every((action) => AUTHORABLE_ACTIONS.includes(action))).toBe(true);
        expect(refusedActions.every((action) => AUTHORABLE_ACTIONS.includes(action))).toBe(true);
    });

    it('keeps both lists frozen and assigns the expected refusal reasons', () => {
        expect(Object.isFrozen(SIGN_ACTION_ENABLED)).toBe(true);
        expect(Object.isFrozen(SIGN_ACTION_REFUSED)).toBe(true);

        for (const [action, reason] of Object.entries(SIGN_ACTION_REFUSED)) {
            expect(reason).toBe(
                CHAIN_GATED_ACTIONS.includes(action)
                    ? 'chain-gated'
                    : 'not yet proven on regtest',
            );
        }
    });

    it('enables every matrix-proven action outside the chain-gated set', () => {
        const expectedEnabled = AUTHORABLE_ACTIONS.filter(
            (action) => !CHAIN_GATED_ACTIONS.includes(action),
        );
        expect(SIGN_ACTION_ENABLED).toHaveLength(27);
        expect(SIGN_ACTION_ENABLED).toEqual(expectedEnabled);

        for (const action of AUTHORABLE_ACTIONS) {
            expect(isSignActionEnabled(action), action).toBe(expectedEnabled.includes(action));
        }

        expect(isSignActionEnabled('send')).toBe(false);
        expect(isSignActionEnabled('UNKNOWN')).toBe(false);
    });
});
