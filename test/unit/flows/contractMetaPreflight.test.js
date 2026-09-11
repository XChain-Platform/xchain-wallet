// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CONTRACT_META_REQUIRED, on the wallet's side of the line.
//
// The chain rejects a DEPLOY whose contract exports no `meta.name` and
// `meta.description`, and the deployer has paid for the transaction by then.
// Both deploy lanes therefore ask the SDK first and refuse BEFORE composing.
//
// The two things worth pinning are the two ways this can be wrong:
//
//   1. It refuses a deploy the chain would accept. `undecidable` (a computed
//      name) must go through, or the wallet blocks a legal contract.
//   2. It fails to refuse, or worse, refuses on garbage. The wallet pins the
//      PUBLISHED SDK, which predates the check, and the web dev-shell's SDK
//      mock is a Proxy that answers every `get*` name with a function. So the
//      detection is on the RESULT, not on `typeof`, and every case below that
//      drives an old or stubbed SDK asserts that a transaction WAS composed.
//
// The refusal string is written out literally here rather than imported from
// the module under test: it is a consensus token the indexer defines, and a
// test that imported the wallet's own copy would pass whatever that copy said.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(),
}));
vi.mock('../../../packages/core/src/flows/sendToken.js', () => ({
    normalizeSource: vi.fn((from) => ({
        address: from.address,
        publicKey: from.publicKey,
        derivationPath: from.derivationPath || null,
        addressId: from.addressId || null,
    })),
    assertValidDestination: vi.fn(),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import {
    readExportedMeta,
    normalizeMetaRead,
    preflightContractMeta,
    metaNameOf,
} from '../../../packages/core/src/flows/contractMetaPreflight.js';
import { deployAction } from '../../../packages/core/src/flows/deployAction.js';
import { deployChunkedRun } from '../../../packages/core/src/flows/deployChunked.js';

const REFUSAL = 'invalid: CONTRACT_MANIFEST (meta required)';

const NAMELESS = 'module.exports = { permissions: [], release(xchain) {} };';
const NAMED = "module.exports = { meta: { name: 'Escrow', description: 'Two-party escrow', "
    + "version: '1.0.0' }, release(xchain) {} };";

const FROM = Object.freeze({
    address: 'bcrt1qexample',
    publicKey: '02aabb',
    derivationPath: "m/84'/0'/0'/0/0",
});

/** An SDK whose `contracts.getExportedMeta` answers exactly `result`. */
function sdkAnswering(result) {
    return { contracts: { getExportedMeta: () => result } };
}

function registryOver(sdk) {
    return { get: () => sdk };
}

/**
 * The web dev-shell's SDK mock: a Proxy answering EVERY property with
 * something callable that returns another Proxy. This is exactly the object a
 * `typeof sdk.contracts.getExportedMeta === 'function'` probe passes against,
 * which is why the wallet checks the RESULT instead.
 */
function proxyStubSdk() {
    const anything = new Proxy(function stub() {}, {
        get: () => anything,
        apply: () => anything,
    });
    return anything;
}

function fakeVault() {
    const puts = [];
    return {
        puts,
        pendingDeploys: {
            put: vi.fn(async (r) => { puts.push(r); return r; }),
            get: vi.fn(async () => null),
            delete: vi.fn(async () => {}),
            findBy: vi.fn(async () => []),
        },
    };
}

beforeEach(() => {
    vi.mocked(submitAction).mockReset();
    vi.mocked(submitAction).mockResolvedValue({ txid: 'deadbeef', indexed: { action_index: '1' } });
});

describe('normalizeMetaRead admits only a real getExportedMeta answer', () => {
    it('accepts the three defined statuses', () => {
        for (const status of ['present', 'absent', 'undecidable']) {
            expect(normalizeMetaRead({ status })).toEqual({ status });
        }
    });

    it('rejects everything else, including a Proxy that answers every property', () => {
        expect(normalizeMetaRead(undefined)).toBeNull();
        expect(normalizeMetaRead(null)).toBeNull();
        expect(normalizeMetaRead('present')).toBeNull();
        expect(normalizeMetaRead([{ status: 'absent' }])).toBeNull();
        expect(normalizeMetaRead({})).toBeNull();
        expect(normalizeMetaRead({ status: 'missing' })).toBeNull();
        expect(normalizeMetaRead(proxyStubSdk())).toBeNull();
    });
});

describe('readExportedMeta never turns a broken SDK into a verdict', () => {
    it('reads a real answer through', () => {
        expect(readExportedMeta(sdkAnswering({ status: 'present', name: 'Escrow' }), NAMED))
            .toEqual({ status: 'present', name: 'Escrow' });
    });

    it('answers null for an SDK with no contracts, no method, or a throwing one', () => {
        expect(readExportedMeta({}, NAMED)).toBeNull();
        expect(readExportedMeta({ contracts: {} }, NAMED)).toBeNull();
        expect(readExportedMeta({
            contracts: { getExportedMeta() { throw new TypeError('not a function'); } },
        }, NAMED)).toBeNull();
    });
});

describe('preflightContractMeta refuses only a PROVEN absence', () => {
    it('throws the consensus string when the source exports no meta', () => {
        expect(() => preflightContractMeta({
            sdkRegistry: registryOver(sdkAnswering({ status: 'absent' })),
            chainId: 'bitcoin-regtest',
            code: NAMELESS,
        })).toThrow(REFUSAL);
    });

    it('passes an undecidable read through: the chain evaluates a computed meta', () => {
        expect(preflightContractMeta({
            sdkRegistry: registryOver(sdkAnswering({ status: 'undecidable' })),
            chainId: 'bitcoin-regtest',
            code: NAMED,
        })).toEqual({ status: 'undecidable' });
    });

    it('passes an SDK that cannot answer through, and reports no name', () => {
        const read = preflightContractMeta({
            sdkRegistry: registryOver(proxyStubSdk()),
            chainId: 'bitcoin-regtest',
            code: NAMELESS,
        });
        expect(read).toBeNull();
        expect(metaNameOf(read)).toBeNull();
    });

    it('reports the exported name for a present read', () => {
        expect(metaNameOf({ status: 'present', name: 'Escrow' })).toBe('Escrow');
        expect(metaNameOf({ status: 'present', name: '   ' })).toBeNull();
        expect(metaNameOf({ status: 'absent' })).toBeNull();
    });
});

// The behaviour that matters is not the helper's return value, it is whether a
// transaction was built. Every case below counts submitAction calls.
describe('the single-leg deploy lane refuses before it composes', () => {
    function deployWith(sdk, code = NAMELESS) {
        return deployAction({
            vault: {},
            walletId: 'w',
            password: 'pw',
            chainRegistry: {},
            sdkRegistry: registryOver(sdk),
            chainId: 'bitcoin-regtest',
            from: FROM,
            params: { VERSION: '0', CODE: code, GAS_LIMIT: '50000' },
        });
    }

    it('refuses a nameless source with the consensus string and composes nothing', async () => {
        await expect(deployWith(sdkAnswering({ status: 'absent' }))).rejects.toThrow(REFUSAL);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('composes when the meta is present, naming the contract off its own source', async () => {
        await deployWith(sdkAnswering({ status: 'present', name: 'Escrow' }), NAMED);
        expect(submitAction).toHaveBeenCalledTimes(1);
        expect(vi.mocked(submitAction).mock.calls[0][0].pendingTxMeta.actionSummary)
            .toContain('Deploy contract "Escrow"');
    });

    it('composes unguarded against an SDK that cannot answer', async () => {
        await deployWith(proxyStubSdk());
        expect(submitAction).toHaveBeenCalledTimes(1);
        expect(vi.mocked(submitAction).mock.calls[0][0].pendingTxMeta.actionSummary)
            .toContain('Deploy contract "(unnamed)"');
    });
});

describe('the chunked deploy lane refuses before it plans or composes', () => {
    function chunkedSdk(metaResult) {
        return {
            contracts: { getExportedMeta: () => metaResult },
            planDeploy: vi.fn(() => ({
                codeHash: 'ab'.repeat(32), single: false, parts: ['p0', 'p1'], totalChunks: 2,
            })),
            waitForAction: vi.fn(async () => ({ action_index: '1' })),
            getAction: vi.fn(async () => ({
                deployed_contract_index: '7', assembly_status: 'valid',
            })),
        };
    }

    it('refuses a nameless source and never asks for a plan', async () => {
        const sdk = chunkedSdk({ status: 'absent' });
        await expect(deployChunkedRun({
            vault: fakeVault(),
            walletId: 'w',
            password: 'pw',
            chainRegistry: {},
            sdkRegistry: registryOver(sdk),
            chainId: 'bitcoin-regtest',
            from: FROM,
            code: NAMELESS,
            gasLimit: '50000',
        })).rejects.toThrow(REFUSAL);
        expect(sdk.planDeploy).not.toHaveBeenCalled();
        expect(submitAction).not.toHaveBeenCalled();
    });

    it("labels the run with the contract's own name when the meta is present", async () => {
        const vault = fakeVault();
        const sdk = chunkedSdk({ status: 'present', name: 'Escrow', version: '1.0.0' });
        await deployChunkedRun({
            vault,
            walletId: 'w',
            password: 'pw',
            chainRegistry: {},
            sdkRegistry: registryOver(sdk),
            chainId: 'bitcoin-regtest',
            from: FROM,
            code: NAMED,
            gasLimit: '50000',
        });
        expect(vault.puts[0].name).toBe('Escrow');
        const assembling = vi.mocked(submitAction).mock.calls
            .map((c) => c[0].pendingTxMeta.actionSummary)
            .find((s) => s.includes('assembling'));
        expect(assembling).toContain('Deploy contract "Escrow"');
    });
});
