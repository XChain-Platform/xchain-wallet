// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Session 34. The controller-bind class list, which was the routing set where
// it had to be the BINDING set.
//
// The wallet's only controller authoring surface offers whatever this flow
// returns, and it offered five of the seven classes the chain accepts on a bind
// (xchain-indexer config CONTROLLER_BINDABLE_CLASSES). The two it dropped are
// not corner cases: `all` is the catch-all the programmable-policy layer is
// designed around - one binding that gates every class, present and future -
// and `ownership` is the class that stops a token's DEED being swept to an
// unapproved address, which is the compliance lane the framework exists for.
//
// It was never only a dropdown. `sdk.controller._assertActionClass` and the SDK
// validator's ACTION_CLASS rule read the same stale list, so neither class could
// be authored by any route through the SDK, hand-built wire strings included.

import { describe, it, expect } from 'vitest';
import {
    controllerActionClasses, controllerBindParams,
} from '../../../packages/core/src/flows/controllerBind.js';

/** The indexer's CONTROLLER_BINDABLE_CLASSES, which a bind is validated against. */
const BINDABLE = ['transfer', 'trade', 'burn', 'mint', 'stake', 'ownership', 'all'];

/** An SDK registry whose SDK has no controller helper at all (the old-SDK path). */
const noControllerRegistry = { get: () => ({}) };

/** A registry standing in for the real helper, so the flow's plumbing is exercised. */
function registryWith(controller) {
    return { get: () => ({ controller }) };
}

describe('controller-bind action classes', () => {
    it('falls back to the BINDABLE set, not the narrower routing set', () => {
        // The fallback is what the form renders against an SDK too old to
        // answer, so a stale list here is a stale dropdown for those users even
        // once the SDK is fixed.
        expect(controllerActionClasses(noControllerRegistry, 'litecoin-regtest'))
            .toEqual(BINDABLE);
    });

    it('prefers the SDK\'s own list when it has one', () => {
        const registry = registryWith({ actionClasses: () => ['transfer', 'all'] });
        expect(controllerActionClasses(registry, 'litecoin-regtest'))
            .toEqual(['transfer', 'all']);
    });

    it('keeps the fallback when the SDK answers with nothing usable', () => {
        const registry = registryWith({ actionClasses: () => [] });
        expect(controllerActionClasses(registry, 'litecoin-regtest')).toEqual(BINDABLE);
    });

    // The half a list-only fix would miss: the builders have to accept the two
    // classes as well, or the dropdown offers a choice the next screen refuses.
    for (const actionClass of ['all', 'ownership']) {
        it(`builds a token bind for the ${actionClass} class`, () => {
            const seen = [];
            const registry = registryWith({
                bindToken: (opts) => { seen.push(opts); return { tick: opts.tick, actionClass, unbind: '0' }; },
            });
            const { action, params } = controllerBindParams({
                sdkRegistry: registry,
                chainId: 'litecoin-regtest',
                target: 'token',
                unbind: false,
                tick: 'GUARDED',
                controller: '1715',
                actionClass,
            });
            expect(action).toBe('ISSUE');
            expect(params.actionClass).toBe(actionClass);
            expect(seen[0]).toMatchObject({ tick: 'GUARDED', controller: '1715', actionClass });
        });
    }
});
