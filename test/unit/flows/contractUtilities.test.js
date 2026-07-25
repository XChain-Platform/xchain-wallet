// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: flows/contractUtilities. Pure wrappers over sdk.contracts.* used
// by the DEPLOY authoring tools (validate / code-size / suggest-gas).
// They resolve the chain-scoped SDK from the registry, forward the code,
// and guard required args.

import { describe, it, expect, vi } from 'vitest';
import {
    contractValidate,
    contractCheckCodeSize,
    contractSuggestGasLimit,
} from '../../../packages/core/src/flows/contractUtilities.js';

function mkRegistry(contracts) {
    const get = vi.fn(() => ({ contracts }));
    return { get };
}

describe('flows/contractUtilities contractValidate', () => {
    it('resolves the chain SDK and forwards the code to validate', async () => {
        const contracts = { validate: vi.fn(async () => ({ valid: true, warnings: [] })) };
        const reg = mkRegistry(contracts);
        const res = await contractValidate({ sdkRegistry: reg, chainId: 'bitcoin-regtest', code: 'export function main(){}' });
        expect(res).toEqual({ valid: true, warnings: [] });
        expect(reg.get).toHaveBeenCalledWith('bitcoin-regtest');
        expect(contracts.validate).toHaveBeenCalledWith('export function main(){}');
    });

    it('passes through a validation failure verbatim', async () => {
        const contracts = { validate: async () => ({ valid: false, error: 'unexpected token' }) };
        const res = await contractValidate({ sdkRegistry: mkRegistry(contracts), chainId: 'c', code: 'bad(' });
        expect(res).toEqual({ valid: false, error: 'unexpected token' });
    });

    it('guards each required arg', async () => {
        const reg = mkRegistry({ validate: async () => ({}) });
        await expect(contractValidate({ chainId: 'c', code: '' })).rejects.toThrow(/sdkRegistry is required/);
        await expect(contractValidate({ sdkRegistry: reg, code: '' })).rejects.toThrow(/chainId is required/);
        await expect(contractValidate({ sdkRegistry: reg, chainId: 'c' })).rejects.toThrow(/code is required/);
        await expect(contractValidate({ sdkRegistry: reg, chainId: 'c', code: 123 })).rejects.toThrow(/code is required/);
    });

    it('treats an empty-string code as present (still validated)', async () => {
        const contracts = { validate: vi.fn(async () => ({ valid: false })) };
        await contractValidate({ sdkRegistry: mkRegistry(contracts), chainId: 'c', code: '' });
        expect(contracts.validate).toHaveBeenCalledWith('');
    });
});

describe('flows/contractUtilities contractCheckCodeSize', () => {
    it('forwards to sdk.contracts.checkCodeSize', async () => {
        const contracts = { checkCodeSize: vi.fn(async () => ({ bytes: 42, withinLimit: true })) };
        const res = await contractCheckCodeSize({ sdkRegistry: mkRegistry(contracts), chainId: 'c', code: 'abc' });
        expect(res).toEqual({ bytes: 42, withinLimit: true });
        expect(contracts.checkCodeSize).toHaveBeenCalledWith('abc');
    });

    it('guards required args', async () => {
        const reg = mkRegistry({ checkCodeSize: async () => ({}) });
        await expect(contractCheckCodeSize({ chainId: 'c', code: '' })).rejects.toThrow(/sdkRegistry is required/);
        await expect(contractCheckCodeSize({ sdkRegistry: reg, code: '' })).rejects.toThrow(/chainId is required/);
        await expect(contractCheckCodeSize({ sdkRegistry: reg, chainId: 'c' })).rejects.toThrow(/code is required/);
    });
});

describe('flows/contractUtilities contractSuggestGasLimit', () => {
    it('forwards to sdk.contracts.suggestGasLimit and passes through its { suggested, rationale } shape', async () => {
        // D-20: the real SDK returns an OBJECT, not a scalar; the passthrough
        // must surface it unchanged so the Deploy form can read .suggested
        // (rendering the whole object as a React child white-screened the form).
        const shape = { suggested: 70000, rationale: '159 bytes, 1 functions, 0 loops' };
        const contracts = { suggestGasLimit: vi.fn(async () => shape) };
        const res = await contractSuggestGasLimit({ sdkRegistry: mkRegistry(contracts), chainId: 'c', code: 'abc' });
        expect(res).toEqual(shape);
        expect(res.suggested).toBe(70000);
        expect(contracts.suggestGasLimit).toHaveBeenCalledWith('abc');
    });

    it('guards required args', async () => {
        const reg = mkRegistry({ suggestGasLimit: async () => 0 });
        await expect(contractSuggestGasLimit({ chainId: 'c', code: '' })).rejects.toThrow(/sdkRegistry is required/);
        await expect(contractSuggestGasLimit({ sdkRegistry: reg, code: '' })).rejects.toThrow(/chainId is required/);
        await expect(contractSuggestGasLimit({ sdkRegistry: reg, chainId: 'c' })).rejects.toThrow(/code is required/);
    });
});
