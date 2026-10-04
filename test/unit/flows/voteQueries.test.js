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
import {
    pollDetail,
    pollResults,
    pollsForChain,
    votesForQuery,
} from '../../../packages/core/src/flows/voteQueries.js';

function registryFor(sdk) {
    return { get: vi.fn(() => sdk) };
}

const QUERY_CASES = [
    ['pollsForChain', pollsForChain, {}],
    ['pollDetail', pollDetail, { pollIndex: 1 }],
    ['pollResults', pollResults, { pollIndex: 1 }],
    ['votesForQuery', votesForQuery, {}],
];

const METHOD_CASES = [
    ['pollsForChain', 'getPolls', pollsForChain, {}],
    ['pollDetail', 'getPoll', pollDetail, { pollIndex: 1 }],
    ['pollResults', 'getPollResults', pollResults, { pollIndex: 1 }],
    ['votesForQuery', 'getVotes', votesForQuery, {}],
];

describe('governance vote queries', () => {
    it.each(QUERY_CASES)('%s requires an SDK registry', async (name, query, params) => {
        await expect(query({ chainId: 'chain-a', ...params }))
            .rejects.toMatchObject({ message: `${name}: sdkRegistry is required` });
    });

    it.each(QUERY_CASES)('%s requires a chain id', async (name, query, params) => {
        await expect(query({ sdkRegistry: registryFor({}), ...params }))
            .rejects.toMatchObject({ message: `${name}: chainId is required` });
    });

    it.each(QUERY_CASES)('%s reports an unknown chain', async (name, query, params) => {
        await expect(query({ sdkRegistry: registryFor(null), chainId: 'missing', ...params }))
            .rejects.toMatchObject({ message: `${name}: no SDK for chain missing` });
    });

    it.each(METHOD_CASES)('%s reports an unavailable SDK method', async (name, method, query, params) => {
        await expect(query({ sdkRegistry: registryFor({}), chainId: 'chain-a', ...params }))
            .rejects.toMatchObject({ message: `${name}: sdk.${method} is unavailable` });
    });

    it.each([
        ['pollDetail', pollDetail],
        ['pollResults', pollResults],
    ])('%s requires a defined poll index', async (name, query) => {
        const sdkRegistry = registryFor({});
        await expect(query({ sdkRegistry, chainId: 'chain-a', pollIndex: undefined }))
            .rejects.toMatchObject({ message: `${name}: pollIndex is required` });
        await expect(query({ sdkRegistry, chainId: 'chain-a', pollIndex: null }))
            .rejects.toMatchObject({ message: `${name}: pollIndex is required` });
    });

    it('pollsForChain forwards filters and returns the SDK result', async () => {
        const result = { data: [{ index: 4 }] };
        const sdk = { getPolls: vi.fn(async () => result) };
        const opts = { page: 2, limit: 10 };
        await expect(pollsForChain({
            sdkRegistry: registryFor(sdk), chainId: 'chain-a', query: 'open', type: 'status', opts,
        })).resolves.toBe(result);
        expect(sdk.getPolls).toHaveBeenCalledWith('open', 'status', opts);
    });

    it('pollsForChain converts omitted filters to null', async () => {
        const sdk = { getPolls: vi.fn(async () => []) };
        await pollsForChain({ sdkRegistry: registryFor(sdk), chainId: 'chain-a' });
        expect(sdk.getPolls).toHaveBeenCalledWith(null, null, undefined);
    });

    it('pollDetail accepts index zero, forwards options, and returns the result', async () => {
        const result = { index: 0 };
        const sdk = { getPoll: vi.fn(async () => result) };
        const opts = { include: 'votes' };
        await expect(pollDetail({
            sdkRegistry: registryFor(sdk), chainId: 'chain-a', pollIndex: 0, opts,
        })).resolves.toBe(result);
        expect(sdk.getPoll).toHaveBeenCalledWith(0, opts);
    });

    it('pollResults accepts index zero, forwards options, and returns the result', async () => {
        const result = { choices: [3, 5] };
        const sdk = { getPollResults: vi.fn(async () => result) };
        const opts = { page: 1 };
        await expect(pollResults({
            sdkRegistry: registryFor(sdk), chainId: 'chain-a', pollIndex: 0, opts,
        })).resolves.toBe(result);
        expect(sdk.getPollResults).toHaveBeenCalledWith(0, opts);
    });

    it('votesForQuery forwards filters and returns the SDK result', async () => {
        const result = { data: [{ voter: 'alice' }] };
        const sdk = { getVotes: vi.fn(async () => result) };
        const opts = { sortorder: 'desc' };
        await expect(votesForQuery({
            sdkRegistry: registryFor(sdk), chainId: 'chain-a', query: 'alice', type: 'address', opts,
        })).resolves.toBe(result);
        expect(sdk.getVotes).toHaveBeenCalledWith('alice', 'address', opts);
    });

    it('votesForQuery converts omitted filters to null', async () => {
        const sdk = { getVotes: vi.fn(async () => []) };
        await votesForQuery({ sdkRegistry: registryFor(sdk), chainId: 'chain-a' });
        expect(sdk.getVotes).toHaveBeenCalledWith(null, null, undefined);
    });
});
