// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';

import { listByActionIndex } from '../../../packages/core/src/flows/listQueries.js';

const CHAIN_ID = 'bitcoin-regtest';

function registryWithActions(actions) {
    const getAction = vi.fn(async (actionIndex) => actions[actionIndex]);
    const sdkRegistry = { get: vi.fn(() => ({ getAction })) };
    return { getAction, sdkRegistry };
}

async function read(sdkRegistry, actionIndex = '100') {
    return listByActionIndex({ sdkRegistry, chainId: CHAIN_ID, actionIndex });
}

describe('listByActionIndex rename resolution', () => {
    it.each([
        ['action_format', 5],
        ['format', '5'],
    ])('follows a LIST rename with %s %s', async (formatField, format) => {
        const target = { action: 'LIST', action_format: 4, action_index: '90' };
        const rename = {
            action: 'LIST',
            [formatField]: format,
            action_index: '100',
            list_action_index: '90',
        };
        const { getAction, sdkRegistry } = registryWithActions({ 90: target, 100: rename });

        await expect(read(sdkRegistry)).resolves.toBe(target);
        expect(sdkRegistry.get).toHaveBeenCalledWith(CHAIN_ID);
        expect(getAction.mock.calls).toEqual([['100'], ['90']]);
    });

    it.each([0, 1, 2, 3, 4])('returns LIST format %s unchanged', async (format) => {
        const action = { action: 'LIST', action_format: format, list_action_index: '90' };
        const { getAction, sdkRegistry } = registryWithActions({ 100: action });

        await expect(read(sdkRegistry)).resolves.toBe(action);
        expect(getAction).toHaveBeenCalledOnce();
    });

    it('returns a format 5 answer without a list action index unchanged', async () => {
        const rename = { action: 'LIST', action_format: 5 };
        const { getAction, sdkRegistry } = registryWithActions({ 100: rename });

        await expect(read(sdkRegistry)).resolves.toBe(rename);
        expect(getAction).toHaveBeenCalledOnce();
    });

    it('returns a non-LIST format 5 answer unchanged', async () => {
        const action = { action: 'SEND', action_format: 5, list_action_index: '90' };
        const { getAction, sdkRegistry } = registryWithActions({ 100: action });

        await expect(read(sdkRegistry)).resolves.toBe(action);
        expect(getAction).toHaveBeenCalledOnce();
    });

    it('stops after one hop when the target is another rename', async () => {
        const target = {
            action: 'LIST',
            action_format: 5,
            action_index: '90',
            list_action_index: '80',
        };
        const rename = {
            action: 'LIST',
            action_format: 5,
            action_index: '100',
            list_action_index: '90',
        };
        const { getAction, sdkRegistry } = registryWithActions({ 80: {}, 90: target, 100: rename });

        await expect(read(sdkRegistry)).resolves.toBe(target);
        expect(getAction.mock.calls).toEqual([['100'], ['90']]);
    });

    it('keeps the required argument errors', async () => {
        await expect(listByActionIndex({})).rejects.toThrow('sdkRegistry is required');
        await expect(listByActionIndex({ sdkRegistry: {} })).rejects.toThrow('chainId is required');
        await expect(listByActionIndex({ sdkRegistry: {}, chainId: CHAIN_ID }))
            .rejects.toThrow('actionIndex is required');
    });
});
