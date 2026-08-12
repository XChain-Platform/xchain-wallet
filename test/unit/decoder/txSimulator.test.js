// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: txSimulator - pure balance-delta projection for all ACTION types.

import { describe, it, expect } from 'vitest';
import { simulateAction } from '../../../packages/core/src/decoder/txSimulator.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const chainRegistry = defaultRegistry();

function balances(coinTick, coinAmt, tokens = []) {
    return [
        { tick: coinTick, amount: coinAmt, isCoin: true },
        ...tokens.map(([tick, amount]) => ({ tick, amount, isCoin: false })),
    ];
}

describe('simulateAction', () => {
    describe('SEND', () => {
        it('debits a token and adds a fee row', () => {
            const r = simulateAction({
                action: 'SEND',
                params: { TICK: 'XCP', AMOUNT: '10', DESTINATION: 'bc1q' },
                balances: balances('BTC', '0.001', [['XCP', '100']]),
                feeEstimate: '0.0001',
                chainId: 'bitcoin-mainnet',
                chainRegistry,
            });
            const tokenDelta = r.deltas.find((d) => d.tick === 'XCP');
            expect(tokenDelta).toBeDefined();
            expect(tokenDelta.before).toBe('100');
            expect(tokenDelta.after).toBe('90');
            expect(tokenDelta.isCoin).toBe(false);
            expect(tokenDelta.isFee).toBe(false);

            const feeDelta = r.deltas.find((d) => d.isFee);
            expect(feeDelta).toBeDefined();
            expect(feeDelta.feeAmount).toBe('0.0001');
        });

        it('coin send folds fee into coin row + adds isFee row', () => {
            const r = simulateAction({
                action: 'SEND',
                params: { TICK: 'BTC', AMOUNT: '0.001', DESTINATION: 'bc1q' },
                balances: balances('BTC', '0.01'),
                feeEstimate: '0.0001',
                chainId: 'bitcoin-mainnet',
                chainRegistry,
            });
            const coinRow = r.deltas.find((d) => d.isCoin && !d.isFee);
            expect(coinRow.before).toBe('0.01');
            // after = 0.01 - 0.001 (principal) - 0.0001 (fee) = 0.0089
            expect(coinRow.after).toBe('0.0089');
            const feeRow = r.deltas.find((d) => d.isFee);
            expect(feeRow.feeAmount).toBe('0.0001');
        });

        it('produces no deltas when TICK and AMOUNT are empty', () => {
            const r = simulateAction({
                action: 'SEND',
                params: {},
                balances: balances('BTC', '1'),
                feeEstimate: '0',
            });
            expect(r.deltas).toHaveLength(0);
            expect(r.sideEffects).toHaveLength(0);
        });
    });

    describe('SWEEP', () => {
        it('zeros every token row', () => {
            const r = simulateAction({
                action: 'SWEEP',
                params: { DESTINATION: 'bc1qrecip' },
                balances: balances('BTC', '1', [['XCP', '50'], ['FILE', '10']]),
                feeEstimate: '0',
            });
            expect(r.deltas.find((d) => d.tick === 'XCP').after).toBe('0');
            expect(r.deltas.find((d) => d.tick === 'FILE').after).toBe('0');
        });

        // SWEEP moves TICK balances/ownerships/escrow, never the native
        // coin: it sits in UTXOs and the sweep tx returns change to the
        // source. Projecting it to zero told a migrating user their whole
        // coin balance left with the tokens, so they could drop the old
        // seed with the coin still on it.
        it('leaves the native coin at the source, less the fee', () => {
            const r = simulateAction({
                action: 'SWEEP',
                params: { DESTINATION: 'bc1qrecip' },
                balances: balances('BTC', '1', [['XCP', '50']]),
                feeEstimate: '0.0001',
                chainId: 'bitcoin-mainnet',
                chainRegistry,
            });
            // Same shape every other fee-only action uses: one coin row,
            // flagged isFee so the sign screen renders it as the fee line.
            const coin = r.deltas.find((d) => d.tick === 'BTC');
            expect(coin.isFee).toBe(true);
            expect(coin.before).toBe('1');
            expect(coin.after).toBe('0.9999');
            expect(r.notes.some((n) => /not swept/i.test(n))).toBe(true);
        });

        it('emits no coin row at all when there is no fee to charge', () => {
            const r = simulateAction({
                action: 'SWEEP',
                params: { DESTINATION: 'bc1qrecip' },
                balances: balances('BTC', '1', [['XCP', '50']]),
                feeEstimate: '0',
            });
            expect(r.deltas.find((d) => d.tick === 'BTC')).toBeUndefined();
        });

        it('leaves token balances put when BALANCES=0 (ownerships only)', () => {
            const r = simulateAction({
                action: 'SWEEP',
                params: { DESTINATION: 'bc1qrecip', BALANCES: '0', OWNERSHIPS: '1' },
                balances: balances('BTC', '1', [['XCP', '50']]),
                feeEstimate: '0',
            });
            expect(r.deltas.find((d) => d.tick === 'XCP')).toBeUndefined();
            expect(r.notes.some((n) => /ownerships only/i.test(n))).toBe(true);
        });

        it('includes the sweep note', () => {
            const r = simulateAction({ action: 'SWEEP', params: { DESTINATION: 'x' }, balances: [] });
            expect(r.notes.some((n) => /sweep/i.test(n))).toBe(true);
        });
    });

    describe('MINT', () => {
        it('adds minted amount to source balance when no DESTINATION', () => {
            const r = simulateAction({
                action: 'MINT',
                params: { TICK: 'MYTOKEN', AMOUNT: '100' },
                balances: balances('BTC', '1', [['MYTOKEN', '200']]),
                feeEstimate: '0',
            });
            const tokenDelta = r.deltas.find((d) => d.tick === 'MYTOKEN');
            expect(tokenDelta.after).toBe('300');
            const supply = r.sideEffects.find((se) => se.kind === 'supply');
            expect(supply.value).toMatch(/\+100/);
        });

        it('does not credit source when DESTINATION is given', () => {
            const r = simulateAction({
                action: 'MINT',
                params: { TICK: 'MYTOKEN', AMOUNT: '50', DESTINATION: 'bc1qother' },
                balances: balances('BTC', '1', [['MYTOKEN', '200']]),
                feeEstimate: '0',
            });
            // No MYTOKEN delta for source.
            expect(r.deltas.find((d) => d.tick === 'MYTOKEN')).toBeUndefined();
            // Supply side-effect still shows.
            expect(r.sideEffects.find((se) => se.kind === 'supply')).toBeDefined();
        });
    });

    describe('DESTROY', () => {
        it('debits the destroyed amount from source', () => {
            const r = simulateAction({
                action: 'DESTROY',
                params: { TICK: 'XCP', AMOUNT: '25' },
                balances: balances('BTC', '1', [['XCP', '100']]),
                feeEstimate: '0',
            });
            const d = r.deltas.find((t) => t.tick === 'XCP');
            expect(d.after).toBe('75');
            const supply = r.sideEffects.find((se) => se.kind === 'supply');
            expect(supply.value).toMatch(/destroyed/);
        });

        it('includes irreversibility note', () => {
            const r = simulateAction({
                action: 'DESTROY',
                params: { TICK: 'XCP', AMOUNT: '1' },
                balances: [],
                feeEstimate: '0',
            });
            expect(r.notes.some((n) => /irreversible/i.test(n))).toBe(true);
        });
    });

    describe('ISSUE', () => {
        it('v0 create shows token-create + supply side effects', () => {
            const r = simulateAction({
                action: 'ISSUE',
                params: { TICK: 'NEWTOKEN', MAX_SUPPLY: '1000000', MINT_SUPPLY: '10000', VERSION: '0' },
                balances: balances('BTC', '1'),
                feeEstimate: '0',
            });
            expect(r.sideEffects.some((se) => se.kind === 'token-create')).toBe(true);
            expect(r.sideEffects.some((se) => se.kind === 'supply')).toBe(true);
            const d = r.deltas.find((d) => d.tick === 'NEWTOKEN');
            expect(d.after).toBe('10000');
        });

        it('v0 transfer shows ownership side effect', () => {
            const r = simulateAction({
                action: 'ISSUE',
                params: { TICK: 'MYTOKEN', TRANSFER: 'bc1qnewowner', VERSION: '0' },
                balances: balances('BTC', '1'),
                feeEstimate: '0',
            });
            expect(r.sideEffects.some((se) => se.kind === 'ownership')).toBe(true);
        });

        it('v3 lock shows lock side effect + note', () => {
            const r = simulateAction({
                action: 'ISSUE',
                params: { TICK: 'MYTOKEN', LOCK_MINT: '1', VERSION: '3' },
                balances: balances('BTC', '1'),
                feeEstimate: '0',
            });
            expect(r.sideEffects.some((se) => se.kind === 'lock')).toBe(true);
            expect(r.notes.some((n) => /permanent/i.test(n))).toBe(true);
        });

        it('other versions show config side effect', () => {
            const r = simulateAction({
                action: 'ISSUE',
                params: { TICK: 'MYTOKEN', DESCRIPTION: 'new desc', VERSION: '1' },
                balances: balances('BTC', '1'),
                feeEstimate: '0',
            });
            expect(r.sideEffects.some((se) => se.kind === 'config')).toBe(true);
        });
    });

    describe('DIVIDEND', () => {
        it('produces dividend side effect + holder note', () => {
            const r = simulateAction({
                action: 'DIVIDEND',
                params: { TICK: 'XCP', DIVIDEND_TICK: 'BTC', AMOUNT: '0.001' },
                balances: balances('BTC', '1'),
                feeEstimate: '0',
            });
            expect(r.sideEffects.some((se) => se.kind === 'dividend')).toBe(true);
            expect(r.notes.some((n) => /holder/i.test(n))).toBe(true);
        });

        it('empty when TICK/DIVIDEND_TICK/AMOUNT missing', () => {
            const r = simulateAction({ action: 'DIVIDEND', params: {}, balances: [] });
            expect(r.sideEffects).toHaveLength(0);
        });
    });

    describe('DISPENSER', () => {
        it('v0 create debits GIVE_ESCROW and adds side effect', () => {
            const r = simulateAction({
                action: 'DISPENSER',
                params: {
                    GIVE_TICK: 'XCP',
                    GIVE_AMOUNT: '10',
                    GIVE_ESCROW: '1000',
                    GET_COIN: 'BTC',
                    GET_AMOUNT: '0.01',
                    VERSION: '0',
                },
                balances: balances('BTC', '1', [['XCP', '5000']]),
                feeEstimate: '0',
            });
            const xcp = r.deltas.find((d) => d.tick === 'XCP');
            expect(xcp.after).toBe('4000');
            expect(r.sideEffects.some((se) => se.kind === 'dispenser')).toBe(true);
        });

        it('v1 cancel produces dispenser cancel side effect', () => {
            const r = simulateAction({
                action: 'DISPENSER',
                params: { VERSION: '1' },
                balances: [],
            });
            expect(r.sideEffects[0].value).toMatch(/cancel/i);
        });

        it('v2 edit with refill debits token', () => {
            const r = simulateAction({
                action: 'DISPENSER',
                params: { VERSION: '2', GIVE_TICK: 'XCP', GIVE_ESCROW: '500' },
                balances: balances('BTC', '1', [['XCP', '2000']]),
                feeEstimate: '0',
            });
            const xcp = r.deltas.find((d) => d.tick === 'XCP');
            expect(xcp.after).toBe('1500');
        });

        it('v2 edit without refill shows list-update side effect', () => {
            const r = simulateAction({
                action: 'DISPENSER',
                params: { VERSION: '2' },
                balances: [],
            });
            expect(r.sideEffects[0].value).toMatch(/list|expiration/i);
        });
    });

    describe('BROADCAST', () => {
        it('v0 plain broadcast side effect', () => {
            const r = simulateAction({
                action: 'BROADCAST',
                params: { MESSAGE: 'hello world', VERSION: '0' },
                balances: [],
            });
            expect(r.sideEffects[0].kind).toBe('broadcast');
            expect(r.sideEffects[0].value).toContain('hello world');
        });

        it('v1 oracle publish side effect', () => {
            const r = simulateAction({
                action: 'BROADCAST',
                params: { MESSAGE: 'xchain.price.btc', VALUE: '50000', VERSION: '1' },
                balances: [],
            });
            expect(r.sideEffects[0].value).toMatch(/50000/);
        });

        it('v2 feed publish side effect', () => {
            const r = simulateAction({
                action: 'BROADCAST',
                params: { MESSAGE: 'myfeed', VERSION: '2' },
                balances: [],
            });
            expect(r.sideEffects[0].label).toMatch(/feed/i);
        });

        it('v3 feed result side effect', () => {
            const r = simulateAction({
                action: 'BROADCAST',
                params: { VALUE: '42', VERSION: '3' },
                balances: [],
            });
            expect(r.sideEffects[0].label).toMatch(/feed result/i);
        });
    });

    describe('LIST', () => {
        it('produces list side effect with address kind', () => {
            const r = simulateAction({
                action: 'LIST',
                params: { TYPE: '2', ITEM: ['bc1qa', 'bc1qb'] },
                balances: [],
            });
            expect(r.sideEffects[0].kind).toBe('list');
            expect(r.sideEffects[0].value).toMatch(/2 address/);
        });

        it('produces list side effect with token kind', () => {
            const r = simulateAction({
                action: 'LIST',
                params: { TYPE: '1', ITEM: 'MYTOKEN' },
                balances: [],
            });
            expect(r.sideEffects[0].value).toMatch(/1 token/);
        });
    });

    describe('AIRDROP', () => {
        it('produces airdrop side effect', () => {
            const r = simulateAction({
                action: 'AIRDROP',
                params: { TICK: 'XCP', AMOUNT: '10', LIST_ACTION_INDEX: '42' },
                balances: balances('BTC', '1'),
                feeEstimate: '0',
            });
            expect(r.sideEffects[0].kind).toBe('airdrop');
            expect(r.notes.some((n) => /list size/i.test(n))).toBe(true);
        });

        it('multi-drop (TICK/AMOUNT as arrays) produces plural description', () => {
            const r = simulateAction({
                action: 'AIRDROP',
                params: { TICK: ['XCP', 'FILE'], AMOUNT: ['10', '5'], LIST_ACTION_INDEX: ['1', '2'] },
                balances: [],
            });
            expect(r.sideEffects[0].value).toMatch(/2 drops/i);
        });
    });

    describe('BATCH', () => {
        it('empty COMMANDS produces note + fee row', () => {
            const r = simulateAction({
                action: 'BATCH',
                params: { COMMANDS: [] },
                balances: balances('BTC', '0.5'),
                feeEstimate: '0.0001',
            });
            expect(r.notes.some((n) => /no decoded/i.test(n))).toBe(true);
            expect(r.deltas.some((d) => d.isFee)).toBe(true);
        });

        it('aggregates SEND + DESTROY sub-action deltas', () => {
            const r = simulateAction({
                action: 'BATCH',
                params: {
                    COMMANDS: [
                        { action: 'SEND', params: { TICK: 'XCP', AMOUNT: '10', DESTINATION: 'x' } },
                        { action: 'DESTROY', params: { TICK: 'XCP', AMOUNT: '5' } },
                    ],
                },
                balances: balances('BTC', '0.001', [['XCP', '100']]),
                feeEstimate: '0.0001',
                chainId: 'bitcoin-mainnet',
                chainRegistry,
            });
            const xcpDelta = r.deltas.find((d) => d.tick === 'XCP');
            // net = -10 (send) + -5 (destroy) = -15
            expect(xcpDelta.after).toBe('85');
        });

        it('skips malformed sub-commands gracefully', () => {
            const r = simulateAction({
                action: 'BATCH',
                params: { COMMANDS: [null, { action: 'SEND', params: { TICK: 'XCP', AMOUNT: '5', DESTINATION: 'x' } }] },
                balances: balances('BTC', '0.001', [['XCP', '50']]),
                feeEstimate: '0',
            });
            const xcpDelta = r.deltas.find((d) => d.tick === 'XCP');
            expect(xcpDelta.after).toBe('45');
        });
    });

    describe('generic fallback', () => {
        it('produces a fee row and a not-simulated note', () => {
            const r = simulateAction({
                action: 'ORDER',
                params: { TICK: 'XCP' },
                balances: balances('BTC', '1'),
                feeEstimate: '0.001',
            });
            expect(r.deltas.some((d) => d.isFee)).toBe(true);
            expect(r.notes.some((n) => /not pre-simulated/i.test(n))).toBe(true);
            expect(r.sideEffects).toHaveLength(0);
        });
    });

    // The confirm screen understated every fee-bearing action because
    // the simulator only ever debited the MINER fee. The numbers below are the
    // ones measured on regtest in wallet E2E session 19 (D-85): the same ISSUE,
    // in each fee-payment mode, projected against what the chain actually did.
    describe('protocol fee', () => {
        const ISSUE_PARAMS = { VERSION: '0', TICK: 'S19FEE', MAX_SUPPLY: '1000', MINT_SUPPLY: '1000' };

        it('debits a native-coin protocol fee on top of the miner fee', () => {
            const r = simulateAction({
                action: 'ISSUE',
                params: ISSUE_PARAMS,
                balances: balances('BTC', '2.99993667'),
                feeEstimate: '0.00001176',
                protocolFee: { amount: '0.00002' },
                chainId: 'bitcoin-regtest',
                chainRegistry,
            });
            // Session 19 measured 2.99990491 on chain; the projection said
            // 2.99992491, understated by exactly the 2000-sat fee output.
            const coinRow = r.deltas.find((d) => d.isCoin && d.before !== '');
            expect(coinRow.before).toBe('2.99993667');
            expect(coinRow.after).toBe('2.99990491');
        });

        it('names the protocol fee as its own row without touching the miner fee row', () => {
            const r = simulateAction({
                action: 'ISSUE',
                params: ISSUE_PARAMS,
                balances: balances('BTC', '2.99993667'),
                feeEstimate: '0.00001176',
                protocolFee: { amount: '0.00002' },
                chainId: 'bitcoin-regtest',
                chainRegistry,
            });
            const networkRow = r.deltas.find((d) => d.isFee && !d.isProtocolFee);
            expect(networkRow.feeAmount).toBe('0.00001176');
            expect(networkRow.feeLabel).toBeUndefined();

            const protocolRow = r.deltas.find((d) => d.isProtocolFee);
            expect(protocolRow.feeAmount).toBe('0.00002');
            expect(protocolRow.feeLabel).toBe('Protocol fee');
            expect(protocolRow.tick).toBe('BTC');
            expect(protocolRow.isCoin).toBe(true);
            // Label-only: the debit itself lives on the row above it, so a
            // renderer never shows the same 2000 sats leaving twice.
            expect(protocolRow.before).toBe('');
            expect(protocolRow.after).toBe('');
            expect(r.deltas.indexOf(protocolRow)).toBe(r.deltas.indexOf(networkRow) + 1);
        });

        it('debits an XCHAIN-denominated protocol fee from the XCHAIN balance', () => {
            const r = simulateAction({
                action: 'ISSUE',
                params: { ...ISSUE_PARAMS, TICK: 'S19MINT' },
                balances: balances('BTC', '2.99995484', [['XCHAIN', '5000']]),
                feeEstimate: '0.00000942',
                protocolFee: { tick: 'XCHAIN', amount: '1' },
                chainId: 'bitcoin-regtest',
                chainRegistry,
            });
            // Session 19: no XCHAIN row appeared at any point, yet the address
            // read 4999 after the block where it had held 5000.
            const xchainRow = r.deltas.find((d) => d.tick === 'XCHAIN');
            expect(xchainRow).toBeDefined();
            expect(xchainRow.before).toBe('5000');
            expect(xchainRow.after).toBe('4999');
            expect(xchainRow.isCoin).toBe(false);
            expect(xchainRow.feeLabel).toBe('Protocol fee');
            // The coin row still shows the miner fee alone.
            const coinRow = r.deltas.find((d) => d.isCoin && d.before !== '');
            expect(coinRow.after).toBe('2.99994542');
        });

        it('folds the protocol fee into a coin SEND row that already carries a principal', () => {
            const r = simulateAction({
                action: 'SEND',
                params: { TICK: 'BTC', AMOUNT: '0.001', DESTINATION: 'bc1q' },
                balances: balances('BTC', '0.01'),
                feeEstimate: '0.0001',
                protocolFee: { amount: '0.00002' },
                chainId: 'bitcoin-mainnet',
                chainRegistry,
            });
            const coinRow = r.deltas.find((d) => d.isCoin && !d.isFee);
            // 0.01 - 0.001 principal - 0.0001 miner - 0.00002 protocol
            expect(coinRow.after).toBe('0.00888');
            expect(r.deltas.filter((d) => d.isProtocolFee)).toHaveLength(1);
        });

        it('carries the whole post-state when there is no miner-fee row to pair with', () => {
            const r = simulateAction({
                action: 'ISSUE',
                params: ISSUE_PARAMS,
                balances: balances('BTC', '1'),
                feeEstimate: '0',
                protocolFee: { amount: '0.00002' },
                chainId: 'bitcoin-mainnet',
                chainRegistry,
            });
            const protocolRow = r.deltas.find((d) => d.isProtocolFee);
            expect(protocolRow.before).toBe('1');
            expect(protocolRow.after).toBe('0.99998');
        });

        it('stays silent when no protocol fee is known, rather than projecting a zero', () => {
            const r = simulateAction({
                action: 'ISSUE',
                params: ISSUE_PARAMS,
                balances: balances('BTC', '1'),
                feeEstimate: '0.0001',
                chainId: 'bitcoin-mainnet',
                chainRegistry,
            });
            expect(r.deltas.some((d) => d.isProtocolFee)).toBe(false);
            const coinRow = r.deltas.find((d) => d.isCoin);
            expect(coinRow.after).toBe('0.9999');
        });

        it('ignores a zero, negative or unparseable protocol fee', () => {
            for (const amount of ['0', '-1', '', 'abc', null, undefined]) {
                const r = simulateAction({
                    action: 'ISSUE',
                    params: ISSUE_PARAMS,
                    balances: balances('BTC', '1'),
                    feeEstimate: '0.0001',
                    protocolFee: { amount },
                    chainId: 'bitcoin-mainnet',
                    chainRegistry,
                });
                expect(r.deltas.some((d) => d.isProtocolFee)).toBe(false);
            }
        });

        it('charges a BATCH protocol fee once, not once per sub-action', () => {
            const r = simulateAction({
                action: 'BATCH',
                params: {
                    COMMANDS: [
                        { action: 'SEND', params: { TICK: 'XCP', AMOUNT: '1', DESTINATION: 'x' } },
                        { action: 'SEND', params: { TICK: 'XCP', AMOUNT: '2', DESTINATION: 'y' } },
                    ],
                },
                balances: balances('BTC', '1', [['XCP', '100']]),
                feeEstimate: '0.0001',
                protocolFee: { amount: '0.00002' },
                chainId: 'bitcoin-mainnet',
                chainRegistry,
            });
            expect(r.deltas.filter((d) => d.isProtocolFee)).toHaveLength(1);
            const coinRow = r.deltas.find((d) => d.isCoin && d.before !== '');
            expect(coinRow.after).toBe('0.99988');
        });
    });

    describe('chainRegistry coin inference', () => {
        it('infers coin tick from chainId via registry', () => {
            const r = simulateAction({
                action: 'SEND',
                params: { TICK: 'LTC', AMOUNT: '1', DESTINATION: 'ltc1q' },
                balances: [{ tick: 'LTC', amount: '10', isCoin: true }],
                feeEstimate: '0.001',
                chainId: 'litecoin-mainnet',
                chainRegistry,
            });
            const feeRow = r.deltas.find((d) => d.isFee);
            expect(feeRow.tick).toBe('LTC');
        });

        it('falls back to isCoin balance when no registry/chainId', () => {
            const r = simulateAction({
                action: 'SEND',
                params: { TICK: 'DOGE', AMOUNT: '1', DESTINATION: 'x' },
                balances: [{ tick: 'DOGE', amount: '100', isCoin: true }],
                feeEstimate: '0.1',
            });
            const feeRow = r.deltas.find((d) => d.isFee);
            expect(feeRow.tick).toBe('DOGE');
        });
    });

    describe('decimal arithmetic edge cases', () => {
        it('handles subtracting more than the balance (goes negative)', () => {
            const r = simulateAction({
                action: 'SEND',
                params: { TICK: 'XCP', AMOUNT: '200', DESTINATION: 'x' },
                balances: balances('BTC', '1', [['XCP', '100']]),
                feeEstimate: '0',
            });
            const d = r.deltas.find((t) => t.tick === 'XCP');
            expect(d.after).toBe('-100');
        });

        it('handles zero fee without adding a fee row', () => {
            const r = simulateAction({
                action: 'SEND',
                params: { TICK: 'XCP', AMOUNT: '1', DESTINATION: 'x' },
                balances: balances('BTC', '1', [['XCP', '10']]),
                feeEstimate: '0',
            });
            expect(r.deltas.some((d) => d.isFee)).toBe(false);
        });
    });
});
