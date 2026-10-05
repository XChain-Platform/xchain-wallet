// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import { getProjectForTick } from '../../../packages/core/src/flows/projectQueries.js';

function fakeRegistry(sdk) {
    return { get: vi.fn(() => sdk) };
}

const FALLBACK_ERRORS = [
    ['status 400', Object.assign(new Error('Explorer rejected request'), { status: 400 })],
    ['status 404', Object.assign(new Error('Explorer rejected request'), { status: 404 })],
    ['response status 400', Object.assign(new Error('Explorer rejected request'), {
        response: { status: 400 },
    })],
    ['response status 404', Object.assign(new Error('Explorer rejected request'), {
        response: { status: 404 },
    })],
    ['HTTP 400 message', new Error('Request failed: HTTP 400')],
    ['HTTP 404 message', new Error('Request failed: HTTP 404')],
    ['not found message', new Error('Project was NOT FOUND')],
];

describe('getProjectForTick lookup', () => {
    it('asks for the selected chain and returns the project', async () => {
        const project = { tick: 'ALPHA', members: [{ tick: 'BETA' }] };
        const sdk = { getProject: vi.fn(async () => project) };
        const sdkRegistry = fakeRegistry(sdk);

        await expect(getProjectForTick({ sdkRegistry, chainId: 'chain-a', tick: 'alpha' }))
            .resolves.toBe(project);
        expect(sdkRegistry.get).toHaveBeenCalledWith('chain-a');
        expect(sdk.getProject).toHaveBeenCalledWith('ALPHA');
    });

    it('returns null when the project is absent', async () => {
        const sdk = { getProject: vi.fn(async () => null) };

        await expect(getProjectForTick({
            sdkRegistry: fakeRegistry(sdk), chainId: 'chain-a', tick: 'missing',
        })).resolves.toBeNull();
    });

    it('returns null when the SDK has no project lookup', async () => {
        await expect(getProjectForTick({
            sdkRegistry: fakeRegistry({}), chainId: 'chain-a', tick: 'missing',
        })).resolves.toBeNull();
    });

    it.each(FALLBACK_ERRORS)('returns null for a lookup error with %s', async (_label, error) => {
        const sdk = { getProject: vi.fn(async () => { throw error; }) };

        await expect(getProjectForTick({
            sdkRegistry: fakeRegistry(sdk), chainId: 'chain-a', tick: 'missing',
        })).resolves.toBeNull();
    });

    it('rethrows an arbitrary project lookup error', async () => {
        const error = new Error('Gateway unavailable');
        const sdk = { getProject: vi.fn(async () => { throw error; }) };

        await expect(getProjectForTick({
            sdkRegistry: fakeRegistry(sdk), chainId: 'chain-a', tick: 'alpha',
        })).rejects.toBe(error);
    });
});

describe('getProjectForTick validation', () => {
    it('rejects a missing registry', async () => {
        await expect(getProjectForTick({ chainId: 'chain-a', tick: 'alpha' }))
            .rejects.toThrow('getProjectForTick: sdkRegistry is required');
    });

    it('rejects a missing chain before consulting the registry', async () => {
        const sdkRegistry = fakeRegistry({ getProject: vi.fn() });

        await expect(getProjectForTick({ sdkRegistry, chainId: '', tick: 'alpha' }))
            .rejects.toThrow('getProjectForTick: chainId is required');
        expect(sdkRegistry.get).not.toHaveBeenCalled();
    });

    it('rejects a missing tick before consulting the registry', async () => {
        const sdkRegistry = fakeRegistry({ getProject: vi.fn() });

        await expect(getProjectForTick({ sdkRegistry, chainId: 'chain-a', tick: '' }))
            .rejects.toThrow('getProjectForTick: tick is required');
        expect(sdkRegistry.get).not.toHaveBeenCalled();
    });
});
