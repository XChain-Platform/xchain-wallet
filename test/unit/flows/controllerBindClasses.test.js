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
    controllerActionClasses, controllerBindParams, controllerBindValidationError,
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

describe('controller-bind value validation', () => {
    const valid = Object.freeze({
        target: 'token',
        unbind: false,
        tick: 'GUARDED',
        controller: '1715',
        actionClass: 'transfer',
    });

    it.each([
        ['an empty guard id', '', /Guard contract is required/],
        ['zero', '0', /positive whole action number/],
        ['a negative id', '-1', /positive whole action number/],
        ['a decimal id', '1.5', /positive whole action number/],
        ['exponent notation', '1e3', /positive whole action number/],
        ['a hexadecimal id', '0x10', /positive whole action number/],
        ['an id above the unsigned 64-bit range', '18446744073709551616', /no greater than 18446744073709551615/],
    ])('refuses %s as the guard id before build', (_name, controller, message) => {
        expect(controllerBindValidationError({ ...valid, controller })).toMatch(message);
    });

    it.each([
        ['a negative cooldown', '-1', /non-negative whole number/],
        ['a decimal cooldown', '1.5', /non-negative whole number/],
        ['an exponent cooldown', '1e3', /non-negative whole number/],
        ['a cooldown above the unsigned 32-bit range', '4294967296', /cannot be greater than 4294967295/],
    ])('refuses %s as the cooldown before build', (_name, cooldownBlocks, message) => {
        expect(controllerBindValidationError({ ...valid, cooldownBlocks })).toMatch(message);
    });

    it('accepts zero cooldown because it means no delay', () => {
        expect(controllerBindValidationError({ ...valid, cooldownBlocks: '0' })).toBeNull();
    });

    it.each([
        ['a malformed token name', 'TWO WORDS', /Token can only use/],
        ['a missing action class', '', /Pick an action class/],
        ['an unknown action class', 'admin', /not available/],
    ])('refuses %s', (_name, value, message) => {
        const input = _name.includes('token') ? { tick: value } : { actionClass: value };
        expect(controllerBindValidationError({ ...valid, ...input })).toMatch(message);
    });

    it('refuses memo delimiters and the UTF-8 byte ceiling', () => {
        expect(controllerBindValidationError({ ...valid, memo: 'a|b' })).toMatch(/cannot contain/);
        expect(controllerBindValidationError({ ...valid, memo: 'é'.repeat(126) }))
            .toMatch(/252 bytes.*at most 250 bytes/);
    });

    it('keeps ignored bind-only values out of unbind validation', () => {
        expect(controllerBindValidationError({
            ...valid,
            unbind: true,
            controller: '-1',
            cooldownBlocks: '1.5',
        })).toBeNull();
    });

    it('applies the same validation at the host-side builder boundary', () => {
        const registry = registryWith({ bindAddress: () => ({}) });
        expect(() => controllerBindParams({
            sdkRegistry: registry,
            chainId: 'bitcoin-mainnet',
            target: 'address',
            unbind: false,
            controller: '1e3',
            actionClass: 'transfer',
        })).toThrow('Guard contract must be a positive whole action number.');
    });

    it('normalizes the reviewed action class exactly as the SDK builder receives it', () => {
        const seen = [];
        const registry = registryWith({
            bindAddress: (opts) => { seen.push(opts); return opts; },
        });
        const result = controllerBindParams({
            sdkRegistry: registry,
            chainId: 'bitcoin-mainnet',
            target: 'address',
            unbind: false,
            controller: '7',
            actionClass: ' TRANSFER ',
        });
        expect(seen[0].actionClass).toBe('transfer');
        expect(result.params.actionClass).toBe('transfer');
    });
});
