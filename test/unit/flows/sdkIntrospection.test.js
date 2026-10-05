// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    getActionFields,
    getActionFormats,
    listActions,
    validateActionDryRun,
} from '../../../packages/core/src/flows/sdkIntrospection.js';

const functions = [
    ['listActions', listActions, false],
    ['getActionFormats', getActionFormats, true],
    ['getActionFields', getActionFields, true],
    ['validateActionDryRun', validateActionDryRun, true],
];

function makeHarness() {
    const sdk = {
        getActions: vi.fn().mockReturnValue(['SEND', 'SWEEP']),
        getActionFormats: vi.fn().mockReturnValue({ version1: 'SEND' }),
        getActionFields: vi.fn().mockReturnValue(['destination', 'quantity']),
        validateAction: vi.fn().mockReturnValue({ valid: true, errors: [] }),
    };
    const sdkRegistry = { get: vi.fn().mockReturnValue(sdk) };
    return { sdk, sdkRegistry };
}

describe.each(functions)('%s argument validation', (name, subject, takesAction) => {
    it('requires sdkRegistry', async () => {
        await expect(subject({ chainId: 'chain', action: 'SEND' }))
            .rejects.toThrow(`${name}: sdkRegistry is required`);
    });

    it('requires chainId', async () => {
        await expect(subject({ sdkRegistry: {}, action: 'SEND' }))
            .rejects.toThrow(`${name}: chainId is required`);
    });

    if (takesAction) {
        it('requires action', async () => {
            await expect(subject({ sdkRegistry: {}, chainId: 'chain' }))
                .rejects.toThrow(`${name}: action is required`);
        });
    }
});

describe('SDK introspection delegation', () => {
    it('returns the actions supplied by the selected SDK', async () => {
        const { sdk, sdkRegistry } = makeHarness();
        await expect(listActions({ sdkRegistry, chainId: 'chain' }))
            .resolves.toEqual(['SEND', 'SWEEP']);
        expect(sdkRegistry.get).toHaveBeenCalledWith('chain');
        expect(sdk.getActions).toHaveBeenCalledWith();
    });

    it('gets formats for the requested action', async () => {
        const { sdk, sdkRegistry } = makeHarness();
        await expect(getActionFormats({ sdkRegistry, chainId: 'chain', action: 'SEND' }))
            .resolves.toEqual({ version1: 'SEND' });
        expect(sdk.getActionFormats).toHaveBeenCalledWith('SEND');
    });

    it.each([undefined, null, ''])('omits an empty field version (%s)', async (version) => {
        const { sdk, sdkRegistry } = makeHarness();
        await getActionFields({ sdkRegistry, chainId: 'chain', action: 'SEND', version });
        expect(sdk.getActionFields).toHaveBeenCalledWith('SEND');
    });

    it('converts a supplied field version to a number', async () => {
        const { sdk, sdkRegistry } = makeHarness();
        await getActionFields({ sdkRegistry, chainId: 'chain', action: 'SEND', version: '2' });
        expect(sdk.getActionFields).toHaveBeenCalledWith('SEND', 2);
    });

    it('defaults dry-run params to an empty object', async () => {
        const { sdk, sdkRegistry } = makeHarness();
        await validateActionDryRun({ sdkRegistry, chainId: 'chain', action: 'SEND' });
        expect(sdk.validateAction).toHaveBeenCalledWith('SEND', {});
    });
});
