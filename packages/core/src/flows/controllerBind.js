// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Phase F: controller-bind param builders.
//
// `core` deliberately doesn't import the SDK (see SDKRegistry.js), so
// the renderer's ControllerBindForm can't call `sdk.controller.*`
// directly. Only the background host holds SDK instances. This flow is
// the thin host-side bridge: it picks the right `sdk.controller.*`
// builder for the requested target (token -> ISSUE v6, address ->
// ADDRESS v1) + operation (bind / unbind), and returns the resulting
// `{ action, params }` for the form to submit through the normal
// `advancedAction` (createAction -> sign -> broadcast) path.
//
// GRACEFUL DEGRADATION: the SDK's `controller` helper ships under
// Phase F Part 2 and may not exist in the installed SDK yet. When it's
// absent (or a builder is missing) this flow throws a clear,
// user-actionable error rather than a cryptic `undefined is not a
// function`. The form surfaces it as the submit error and stays on the
// review screen.

import { memoLengthError } from '../shared/utils/memoLimit.js';
import { tickerReferenceError } from '../shared/utils/tickerGrammar.js';

const ACTION_CLASSES = Object.freeze(['transfer', 'trade', 'burn', 'mint', 'stake', 'ownership', 'all']);
const MAX_ACTION_INDEX = 18446744073709551615n;
const MAX_COOLDOWN_BLOCKS = 4294967295n;

/**
 * @typedef {Object} ControllerBindOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {'token' | 'address'} target
 * @property {boolean} unbind
 * @property {string} [tick]            required when target === 'token'
 * @property {string} [controller]      action_index of the guard contract; bind only
 * @property {string} actionClass       transfer | trade | burn | mint | stake | ownership | all
 * @property {string|number} [cooldownBlocks]  bind only; ignored on unbind
 * @property {string} [memo]
 */

/**
 * Return the first plain-language reason the form values cannot be built.
 *
 * @param {Partial<ControllerBindOpts>} opts
 * @returns {string|null}
 */
export function controllerBindValidationError(opts = {}) {
    const target = opts.target;
    const unbind = Boolean(opts.unbind);
    if (target !== 'token' && target !== 'address') {
        return 'Choose whether to protect a token or this address.';
    }

    if (target === 'token') {
        const tickError = tickerReferenceError(opts.tick, { noun: 'Token' });
        if (tickError) return tickError;
    }

    if (!unbind) {
        const controller = String(opts.controller ?? '').trim();
        if (!controller) {
            return 'Guard contract is required. Enter the action number of a deployed contract.';
        }
        if (!/^\d+$/.test(controller) || /^0+$/.test(controller)) {
            return 'Guard contract must be a positive whole action number.';
        }
        if (BigInt(controller) > MAX_ACTION_INDEX) {
            return `Guard contract is too large. Enter an action number no greater than ${MAX_ACTION_INDEX}.`;
        }
    }

    const actionClass = String(opts.actionClass ?? '').trim().toLowerCase();
    if (!actionClass) return 'Pick an action class to gate.';
    if (!ACTION_CLASSES.includes(actionClass)) {
        return 'The selected action class is not available. Refresh the form and choose another.';
    }

    if (!unbind && opts.cooldownBlocks !== undefined && String(opts.cooldownBlocks).trim() !== '') {
        const cooldown = String(opts.cooldownBlocks).trim();
        if (!/^\d+$/.test(cooldown)) {
            return 'Cooldown blocks must be a non-negative whole number.';
        }
        if (BigInt(cooldown) > MAX_COOLDOWN_BLOCKS) {
            return `Cooldown blocks cannot be greater than ${MAX_COOLDOWN_BLOCKS}.`;
        }
    }

    const memo = String(opts.memo ?? '').trim();
    if (/[|;]/.test(memo)) return 'Memo cannot contain | or ; characters.';
    return memoLengthError(memo);
}

/**
 * Build the `{ action, params }` for a controller bind/unbind via the
 * SDK's controller helper.
 *
 * @param {ControllerBindOpts} opts
 * @returns {{ action: 'ISSUE' | 'ADDRESS', params: Record<string, unknown> }}
 */
export function controllerBindParams(opts) {
    if (!opts) throw new Error('controllerBindParams: opts is required');
    const { sdkRegistry, chainId, target } = opts;
    if (!sdkRegistry) throw new Error('controllerBindParams: sdkRegistry is required');
    if (!chainId) throw new Error('controllerBindParams: chainId is required');
    const validationError = controllerBindValidationError(opts);
    if (validationError) throw new Error(validationError);

    const sdk = sdkRegistry.get(chainId);
    const controller = sdk && sdk.controller;
    if (!controller) {
        throw new Error(
            'Controller binding needs a newer XChain SDK. Update the wallet to bind or unbind a controller.',
        );
    }

    const unbind = Boolean(opts.unbind);
    const actionClass = String(opts.actionClass).trim().toLowerCase();
    /** @type {'ISSUE' | 'ADDRESS'} */
    const action = target === 'token' ? 'ISSUE' : 'ADDRESS';

    /** @type {Record<string, unknown>} */
    let params;
    if (target === 'token') {
        if (typeof opts.tick !== 'string' || opts.tick.trim() === '') {
            throw new Error('controllerBindParams: tick is required when binding a token controller');
        }
        const base = {
            tick: opts.tick.trim(),
            controller: opts.controller,
            actionClass,
            ...(opts.memo ? { memo: opts.memo } : {}),
        };
        if (unbind) {
            if (typeof controller.unbindToken !== 'function') {
                throw new Error('Controller binding needs a newer XChain SDK (unbindToken unavailable).');
            }
            params = controller.unbindToken(base);
        } else {
            if (typeof controller.bindToken !== 'function') {
                throw new Error('Controller binding needs a newer XChain SDK (bindToken unavailable).');
            }
            params = controller.bindToken({
                ...base,
                ...(opts.cooldownBlocks !== undefined && opts.cooldownBlocks !== '' && {
                    cooldownBlocks: opts.cooldownBlocks,
                }),
            });
        }
    } else {
        const base = {
            controller: opts.controller,
            actionClass,
            ...(opts.memo ? { memo: opts.memo } : {}),
        };
        if (unbind) {
            if (typeof controller.unbindAddress !== 'function') {
                throw new Error('Controller binding needs a newer XChain SDK (unbindAddress unavailable).');
            }
            params = controller.unbindAddress(base);
        } else {
            if (typeof controller.bindAddress !== 'function') {
                throw new Error('Controller binding needs a newer XChain SDK (bindAddress unavailable).');
            }
            params = controller.bindAddress({
                ...base,
                ...(opts.cooldownBlocks !== undefined && opts.cooldownBlocks !== '' && {
                    cooldownBlocks: opts.cooldownBlocks,
                }),
            });
        }
    }

    return { action, params };
}

/**
 * The canonical action-class list, used to populate the form's
 * dropdown. Mirrors `sdk.controller.actionClasses()` when the SDK is
 * present; otherwise falls back to the locked-fact list so the form
 * still renders (the actual submit then degrades with a clear error).
 *
 * @param {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @param {string} chainId
 * @returns {string[]}
 */
export function controllerActionClasses(sdkRegistry, chainId) {
    // Mirrors the indexer's CONTROLLER_BINDABLE_CLASSES (bindable, not routable:
    // a bind may target the 'all' catch-all, which no incoming action routes to).
    try {
        const sdk = sdkRegistry.get(chainId);
        const fn = sdk && sdk.controller && sdk.controller.actionClasses;
        if (typeof fn === 'function') {
            const list = fn.call(sdk.controller);
            if (Array.isArray(list) && list.length > 0) return list;
        }
    } catch {
        // fall through to the locked-fact list
    }
    return [...ACTION_CLASSES];
}
