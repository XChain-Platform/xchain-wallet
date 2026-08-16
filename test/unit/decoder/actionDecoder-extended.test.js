// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Extended coverage for actionDecoder: ISSUE (all versions), MINT,
// DESTROY, BROADCAST (all versions), DISPENSER (all versions), DIVIDEND,
// LIST (v0 + v1), AIRDROP (v0–v3), and BATCH.

import { describe, it, expect } from 'vitest';
import { decodeAction } from '../../../packages/core/src/decoder/actionDecoder.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const chainRegistry = defaultRegistry();

describe('decodeAction extended', () => {
    describe('MINT', () => {
        it('produces a mint summary with destination', () => {
            const d = decodeAction({
                action: 'MINT',
                params: { TICK: 'MYTOKEN', AMOUNT: '100', DESTINATION: 'bc1qrecip' },
            });
            expect(d.summary).toBe('Mint 100 MYTOKEN to bc1qrecip');
        });

        it('defaults destination label to broadcasting address when empty', () => {
            const d = decodeAction({
                action: 'MINT',
                params: { TICK: 'MYTOKEN', AMOUNT: '50' },
            });
            expect(d.details.find((r) => r.label === 'Destination').value).toBe('broadcasting address');
        });

        it('warns on empty ticker', () => {
            const d = decodeAction({ action: 'MINT', params: { TICK: '', AMOUNT: '1' } });
            expect(d.warnings.some((w) => /ticker is empty/i.test(w))).toBe(true);
        });

        it('warns on non-positive amount', () => {
            const d = decodeAction({ action: 'MINT', params: { TICK: 'X', AMOUNT: '0' } });
            expect(d.warnings.some((w) => /positive/i.test(w))).toBe(true);
        });

        it('warns on memo with forbidden chars', () => {
            const d = decodeAction({ action: 'MINT', params: { TICK: 'X', AMOUNT: '1', MEMO: 'bad|memo' } });
            expect(d.warnings.some((w) => /memo contains/i.test(w))).toBe(true);
        });

        it('includes memo row when non-empty', () => {
            const d = decodeAction({ action: 'MINT', params: { TICK: 'X', AMOUNT: '1', MEMO: 'hello' } });
            expect(d.details.find((r) => r.label === 'Memo').value).toBe('hello');
        });
    });

    describe('DESTROY', () => {
        it('v0 single destroy summary', () => {
            const d = decodeAction({
                action: 'DESTROY',
                params: { TICK: 'XCP', AMOUNT: '10', VERSION: '0' },
                chainId: 'bitcoin-mainnet',
                chainRegistry,
            });
            expect(d.summary).toBe('Destroy 10 XCP on Bitcoin');
            expect(d.warnings.some((w) => /irreversible/i.test(w))).toBe(true);
        });

        it('v0 without VERSION field treated as single', () => {
            const d = decodeAction({ action: 'DESTROY', params: { TICK: 'XCP', AMOUNT: '5' } });
            expect(d.summary).toMatch(/^Destroy/);
        });

        // This used to assert the generic "Sign Destroy" fallback.
        // Multi-destroy is described leg by leg now, so the summary names
        // what is being burned instead of telling the user to go read raw
        // params on the screen where they approve an irreversible burn.
        it('multi-destroy names each leg and keeps the irreversibility warning', () => {
            const d = decodeAction({ action: 'DESTROY', params: { TICK: 'XCP', AMOUNT: '5', VERSION: '1' } });
            expect(d.summary).toBe('Destroy: 5 XCP');
            expect(d.warnings.some((w) => /irreversible/i.test(w))).toBe(true);
            expect(d.warnings.join('\n')).not.toMatch(/No plain-English summary is available/);
        });

        it('warns empty ticker + non-positive amount in v0', () => {
            const d = decodeAction({ action: 'DESTROY', params: { TICK: '', AMOUNT: '0' } });
            expect(d.warnings.some((w) => /ticker is empty/i.test(w))).toBe(true);
            expect(d.warnings.some((w) => /positive/i.test(w))).toBe(true);
        });
    });

    describe('ISSUE', () => {
        it('v0 full create with max supply', () => {
            const d = decodeAction({
                action: 'ISSUE',
                params: { TICK: 'NEWTOKEN', MAX_SUPPLY: '1000000', VERSION: '0' },
            });
            expect(d.summary).toContain('Create token NEWTOKEN');
            expect(d.summary).toContain('max supply 1000000');
        });

        it('v0 create without max supply', () => {
            const d = decodeAction({
                action: 'ISSUE',
                params: { TICK: 'NEWTOKEN', MINT_SUPPLY: '500', VERSION: '0' },
            });
            expect(d.summary).toBe('Create token NEWTOKEN');
        });

        it('v0 fair-mint edition shows the mint-window fields', () => {
            const d = decodeAction({
                action: 'ISSUE',
                params: {
                    TICK: 'PRINTS',
                    MAX_SUPPLY: '100',
                    DECIMALS: '0',
                    LOCK_MAX_SUPPLY: '1',
                    MAX_MINT: '1',
                    MINT_ADDRESS_MAX: '2',
                    MINT_START_BLOCK: '900000',
                    MINT_STOP_BLOCK: '910000',
                    VERSION: '0',
                },
            });
            expect(d.summary).toContain('Create token PRINTS');
            const labels = d.details.map((x) => x.label);
            expect(labels).toContain('Max mint per address');
            expect(labels).toContain('Mint start block');
            expect(labels).toContain('Mint stop block');
            expect(d.warnings.some((w) => /locking is permanent/i.test(w))).toBe(true);
        });

        it('v0 transfer-only summary', () => {
            const d = decodeAction({
                action: 'ISSUE',
                params: { TICK: 'MYTOKEN', TRANSFER: 'bc1qnewowner', VERSION: '0' },
            });
            expect(d.summary).toContain('Transfer ownership');
        });

        it('v0 configure update summary (no create/transfer fields)', () => {
            const d = decodeAction({
                action: 'ISSUE',
                params: { TICK: 'MYTOKEN', DESCRIPTION: 'new', VERSION: '0' },
            });
            expect(d.summary).toContain('Configure token');
        });

        it('v0 lock flags show warning', () => {
            const d = decodeAction({
                action: 'ISSUE',
                params: { TICK: 'X', LOCK_MAX_SUPPLY: '1', VERSION: '0' },
            });
            expect(d.warnings.some((w) => /locking is permanent/i.test(w))).toBe(true);
        });

        // PC-06: the wizard's advanced disclosure is the first wallet
        // path that fills the callback trio and the access lists in at
        // CREATE time, so the confirm screen has to describe them - a
        // bound allow-list and a configured callback are exactly the
        // settings a user must not approve blind.
        it('v0 describes a callback configured at create, with a plain-language warning', () => {
            const d = decodeAction({
                action: 'ISSUE',
                params: {
                    TICK: 'X', VERSION: '0', MAX_SUPPLY: '100',
                    CALLBACK_BLOCK: '900100', CALLBACK_TICK: 'XCHAIN', CALLBACK_AMOUNT: '1',
                },
            });
            const rows = Object.fromEntries(d.details.map((r) => [r.label, r.value]));
            expect(rows['Callback at block']).toBe('900100');
            expect(rows['Callback token']).toBe('XCHAIN');
            expect(rows['Callback amount']).toBe('1');
            expect(d.warnings.some((w) => /recall every holder/i.test(w))).toBe(true);
        });

        it('v0 describes access lists bound at create, warning that an allow list is default-deny', () => {
            const d = decodeAction({
                action: 'ISSUE',
                params: { TICK: 'X', VERSION: '0', MAX_SUPPLY: '100', ALLOW_LIST: '412', BLOCK_LIST: '77' },
            });
            const rows = Object.fromEntries(d.details.map((r) => [r.label, r.value]));
            expect(rows['Allow list']).toBe('412');
            expect(rows['Block list']).toBe('77');
            expect(d.warnings.some((w) => /Everyone else is denied/i.test(w))).toBe(true);
        });

        it('v0 block list alone does not raise the allow-list restriction warning', () => {
            const d = decodeAction({
                action: 'ISSUE',
                params: { TICK: 'X', VERSION: '0', MAX_SUPPLY: '100', BLOCK_LIST: '77' },
            });
            expect(d.warnings.some((w) => /Everyone else is denied/i.test(w))).toBe(false);
        });

        it('v0 uses the same row labels as the v4 / v5 edit branches', () => {
            const create = decodeAction({
                action: 'ISSUE',
                params: {
                    TICK: 'X', VERSION: '0', MAX_SUPPLY: '100',
                    CALLBACK_BLOCK: '900100', CALLBACK_TICK: 'XCHAIN', CALLBACK_AMOUNT: '1',
                    ALLOW_LIST: '412', BLOCK_LIST: '77',
                },
            });
            const edit4 = decodeAction({
                action: 'ISSUE',
                params: { TICK: 'X', VERSION: '4', CALLBACK_BLOCK: '900100', CALLBACK_TICK: 'XCHAIN', CALLBACK_AMOUNT: '1' },
            });
            const edit5 = decodeAction({
                action: 'ISSUE',
                params: { TICK: 'X', VERSION: '5', ALLOW_LIST: '412', BLOCK_LIST: '77' },
            });
            const labels = (d) => d.details.map((r) => r.label);
            for (const label of [...labels(edit4), ...labels(edit5)]) {
                expect(labels(create)).toContain(label);
            }
        });

        it('v0 create with none of them is unchanged', () => {
            const d = decodeAction({
                action: 'ISSUE',
                params: { TICK: 'X', VERSION: '0', MAX_SUPPLY: '100', MINT_SUPPLY: '100' },
            });
            expect(d.details.map((r) => r.label))
                .toEqual(['Token', 'Max supply', 'Initial mint']);
            expect(d.warnings).toEqual([]);
        });

        it('v1 edit description summary', () => {
            const d = decodeAction({ action: 'ISSUE', params: { TICK: 'X', DESCRIPTION: 'new desc', VERSION: '1' } });
            expect(d.summary).toContain('Update description of X');
        });

        it('v2 edit mint params summary', () => {
            const d = decodeAction({ action: 'ISSUE', params: { TICK: 'X', MAX_MINT: '10', VERSION: '2' } });
            expect(d.summary).toContain('Update mint parameters of X');
        });

        it('v3 lock params summary with active flags', () => {
            const d = decodeAction({ action: 'ISSUE', params: { TICK: 'X', LOCK_MINT: '1', VERSION: '3' } });
            expect(d.summary).toContain('Lock X');
            expect(d.warnings.some((w) => /permanent/i.test(w))).toBe(true);
        });

        it('v3 no active flags: generic update label', () => {
            const d = decodeAction({ action: 'ISSUE', params: { TICK: 'X', VERSION: '3' } });
            expect(d.summary).toContain('Update lock parameters');
        });

        it('v4 edit callback params summary', () => {
            const d = decodeAction({ action: 'ISSUE', params: { TICK: 'X', CALLBACK_BLOCK: '900000', VERSION: '4' } });
            expect(d.summary).toContain('Update callback parameters');
        });

        it('v5 edit allow/block list summary', () => {
            const d = decodeAction({ action: 'ISSUE', params: { TICK: 'X', ALLOW_LIST: '123', VERSION: '5' } });
            expect(d.summary).toContain('allow/block list');
        });

        it('warns on empty ticker in any version', () => {
            for (const v of ['0', '1', '2', '3', '4', '5']) {
                const d = decodeAction({ action: 'ISSUE', params: { TICK: '', VERSION: v } });
                expect(d.warnings.some((w) => /ticker is empty/i.test(w))).toBe(true);
            }
        });
    });

    describe('BROADCAST', () => {
        it('v0 plain message', () => {
            const d = decodeAction({ action: 'BROADCAST', params: { MESSAGE: 'hello', VERSION: '0' } });
            expect(d.summary).toContain('"hello"');
            expect(d.warnings.length).toBe(0);
        });

        it('v0 empty message warns', () => {
            const d = decodeAction({ action: 'BROADCAST', params: { VERSION: '0' } });
            expect(d.warnings.some((w) => /message is empty/i.test(w))).toBe(true);
        });

        it('v0 warns on forbidden char in message', () => {
            const d = decodeAction({ action: 'BROADCAST', params: { MESSAGE: 'bad|message', VERSION: '0' } });
            expect(d.warnings.some((w) => /message contains/i.test(w))).toBe(true);
        });

        it('v1 oracle with feed + value', () => {
            const d = decodeAction({ action: 'BROADCAST', params: { MESSAGE: 'xchain.price', VALUE: '50000', VERSION: '1' } });
            expect(d.summary).toContain('oracle value 50000');
            expect(d.summary).toContain('xchain.price');
        });

        it('v1 warns on empty feed name', () => {
            const d = decodeAction({ action: 'BROADCAST', params: { VALUE: '1', VERSION: '1' } });
            expect(d.warnings.some((w) => /feed name is empty/i.test(w))).toBe(true);
        });

        it('v2 feed URL + fee', () => {
            const d = decodeAction({ action: 'BROADCAST', params: { MESSAGE: 'myfeed.json', FEE: '1', VERSION: '2' } });
            expect(d.summary).toContain('myfeed.json');
            expect(d.details.find((r) => r.label === 'Feed fee')).toBeDefined();
        });

        it('v3 feed result with action index', () => {
            const d = decodeAction({ action: 'BROADCAST', params: { VALUE: '99', BROADCAST_ACTION_INDEX: '77', VERSION: '3' } });
            expect(d.summary).toContain('feed #77');
        });

        it('v3 warns on empty action index', () => {
            const d = decodeAction({ action: 'BROADCAST', params: { VERSION: '3' } });
            expect(d.warnings.some((w) => /action index is empty/i.test(w))).toBe(true);
        });
    });

    describe('DISPENSER', () => {
        it('v0 creates a detailed dispenser summary', () => {
            const d = decodeAction({
                action: 'DISPENSER',
                params: {
                    GIVE_TICK: 'XCP',
                    GIVE_AMOUNT: '10',
                    GIVE_ESCROW: '1000',
                    GET_COIN: 'BTC',
                    GET_AMOUNT: '0.01',
                    VERSION: '0',
                },
            });
            expect(d.summary).toContain('Create dispenser');
            expect(d.summary).toContain('XCP');
        });

        it('v0 fills estimate row when GIVE_AMOUNT and GIVE_ESCROW set', () => {
            const d = decodeAction({
                action: 'DISPENSER',
                params: { GIVE_TICK: 'X', GIVE_AMOUNT: '10', GIVE_ESCROW: '100', GET_COIN: 'BTC', GET_AMOUNT: '1', VERSION: '0' },
            });
            const est = d.details.find((r) => r.label === 'Estimated fills');
            expect(est.value).toBe('10');
        });

        it('v0 warns when escrow smaller than per-fill', () => {
            const d = decodeAction({
                action: 'DISPENSER',
                params: { GIVE_TICK: 'X', GIVE_AMOUNT: '100', GIVE_ESCROW: '50', GET_COIN: 'BTC', GET_AMOUNT: '1', VERSION: '0' },
            });
            expect(d.warnings.some((w) => /never dispense/i.test(w))).toBe(true);
        });

        it('v0 fiat oracle pricing mode', () => {
            const d = decodeAction({
                action: 'DISPENSER',
                params: { GIVE_TICK: 'X', GIVE_AMOUNT: '1', GIVE_ESCROW: '10', GET_COIN: 'BTC', GET_AMOUNT: '1', ORACLE_ADDRESS: 'bc1qoracle', VERSION: '0' },
            });
            expect(d.summary).toContain('oracle-priced');
            expect(d.warnings.some((w) => /fiat currency/i.test(w))).toBe(true);
        });

        it('v1 cancel with index', () => {
            const d = decodeAction({ action: 'DISPENSER', params: { DISPENSER_ACTION_INDEX: '42', VERSION: '1' } });
            expect(d.summary).toContain('Cancel dispenser');
            expect(d.summary).toContain('#42');
            expect(d.warnings.some((w) => /1-hour/i.test(w))).toBe(true);
        });

        it('v2 edit dispenser', () => {
            const d = decodeAction({ action: 'DISPENSER', params: { DISPENSER_ACTION_INDEX: '7', GIVE_ESCROW: '100', VERSION: '2' } });
            expect(d.summary).toContain('Edit dispenser');
            expect(d.warnings.some((w) => /1-hour delay/i.test(w))).toBe(true);
        });
    });

    describe('DIVIDEND', () => {
        it('produces a pay-per-unit summary', () => {
            const d = decodeAction({ action: 'DIVIDEND', params: { TICK: 'XCP', DIVIDEND_TICK: 'BTC', AMOUNT: '0.001' } });
            expect(d.summary).toBe('Pay 0.001 BTC per unit of XCP');
        });

        it('warns on empty holder ticker', () => {
            const d = decodeAction({ action: 'DIVIDEND', params: { DIVIDEND_TICK: 'BTC', AMOUNT: '1' } });
            expect(d.warnings.some((w) => /holder ticker/i.test(w))).toBe(true);
        });

        it('warns on empty dividend ticker', () => {
            const d = decodeAction({ action: 'DIVIDEND', params: { TICK: 'XCP', AMOUNT: '1' } });
            expect(d.warnings.some((w) => /dividend ticker/i.test(w))).toBe(true);
        });

        it('warns on non-positive per-unit amount', () => {
            const d = decodeAction({ action: 'DIVIDEND', params: { TICK: 'XCP', DIVIDEND_TICK: 'BTC', AMOUNT: '0' } });
            expect(d.warnings.some((w) => /per-unit amount/i.test(w))).toBe(true);
        });
    });

    describe('LIST', () => {
        it('v0 create address list', () => {
            const d = decodeAction({ action: 'LIST', params: { TYPE: '2', ITEM: ['bc1qa', 'bc1qb'] } });
            expect(d.summary).toContain('address list of 2 items');
        });

        it('v0 create token list singular', () => {
            const d = decodeAction({ action: 'LIST', params: { TYPE: '1', ITEM: 'MYTOKEN' } });
            expect(d.summary).toContain('1 item');
        });

        it('v0 warns on empty type', () => {
            const d = decodeAction({ action: 'LIST', params: { ITEM: ['x'] } });
            expect(d.warnings.some((w) => /type is empty/i.test(w))).toBe(true);
        });

        it('v0 warns on zero items', () => {
            const d = decodeAction({ action: 'LIST', params: { TYPE: '2' } });
            expect(d.warnings.some((w) => /no items/i.test(w))).toBe(true);
        });

        it('v0 sample row for ≤5 items', () => {
            const d = decodeAction({ action: 'LIST', params: { TYPE: '2', ITEM: ['a', 'b', 'c'] } });
            expect(d.details.find((r) => r.label === 'Sample')).toBeDefined();
        });

        it('v1 add items to list', () => {
            const d = decodeAction({ action: 'LIST', params: { VERSION: '1', EDIT: '1', LIST_ACTION_INDEX: '10', ITEM: 'bc1q' } });
            expect(d.summary).toContain('Add 1 item to list #10');
        });

        it('v1 remove items', () => {
            const d = decodeAction({ action: 'LIST', params: { VERSION: '1', EDIT: '2', LIST_ACTION_INDEX: '10', ITEM: ['a', 'b'] } });
            expect(d.summary).toContain('Remove 2 items from list #10');
        });

        it('v1 warns on empty edit direction', () => {
            const d = decodeAction({ action: 'LIST', params: { VERSION: '1', LIST_ACTION_INDEX: '1', ITEM: 'x' } });
            expect(d.warnings.some((w) => /edit direction is empty/i.test(w))).toBe(true);
        });

        it('v1 warns on empty parent index', () => {
            const d = decodeAction({ action: 'LIST', params: { VERSION: '1', EDIT: '1', ITEM: 'x' } });
            expect(d.warnings.some((w) => /action index is empty/i.test(w))).toBe(true);
        });
    });

    describe('AIRDROP', () => {
        it('v0 single airdrop summary', () => {
            const d = decodeAction({ action: 'AIRDROP', params: { TICK: 'XCP', AMOUNT: '10', LIST_ACTION_INDEX: '5' } });
            expect(d.summary).toContain('Airdrop 10 XCP');
            expect(d.summary).toContain('list #5');
        });

        it('v0 warns on empty TICK', () => {
            const d = decodeAction({ action: 'AIRDROP', params: { AMOUNT: '1', LIST_ACTION_INDEX: '1' } });
            expect(d.warnings.some((w) => /ticker is empty/i.test(w))).toBe(true);
        });

        it('v0 warns on non-positive amount', () => {
            const d = decodeAction({ action: 'AIRDROP', params: { TICK: 'X', AMOUNT: '0', LIST_ACTION_INDEX: '1' } });
            expect(d.warnings.some((w) => /per-recipient amount/i.test(w))).toBe(true);
        });

        it('v0 warns on empty list index', () => {
            const d = decodeAction({ action: 'AIRDROP', params: { TICK: 'X', AMOUNT: '1' } });
            expect(d.warnings.some((w) => /list action index is empty/i.test(w))).toBe(true);
        });

        it('v0 memo forbidden char warning', () => {
            const d = decodeAction({ action: 'AIRDROP', params: { TICK: 'X', AMOUNT: '1', LIST_ACTION_INDEX: '1', MEMO: 'bad;memo' } });
            expect(d.warnings.some((w) => /memo contains/i.test(w))).toBe(true);
        });

        it('v1 multi-token single list', () => {
            const d = decodeAction({ action: 'AIRDROP', params: { VERSION: '1', TICK: ['XCP', 'FILE'], AMOUNT: ['10', '5'], LIST_ACTION_INDEX: '3' } });
            expect(d.summary).toContain('Airdrop');
            expect(d.summary).toContain('XCP');
            expect(d.summary).toContain('FILE');
        });

        it('v2 multi-token multi-list', () => {
            const d = decodeAction({ action: 'AIRDROP', params: { VERSION: '2', TICK: ['XCP', 'FILE'], AMOUNT: ['10', '5'], LIST_ACTION_INDEX: ['1', '2'] } });
            expect(d.details.some((r) => r.label === 'Drop 1')).toBe(true);
            expect(d.details.some((r) => r.label === 'Drop 2')).toBe(true);
        });

        it('v3 per-drop memos shown', () => {
            const d = decodeAction({ action: 'AIRDROP', params: { VERSION: '3', TICK: ['XCP'], AMOUNT: ['1'], LIST_ACTION_INDEX: ['1'], MEMO: ['hi'] } });
            expect(d.details.some((r) => r.label.includes('Memo'))).toBe(true);
        });
    });

    describe('BATCH', () => {
        it('empty COMMANDS fallback', () => {
            const d = decodeAction({ action: 'BATCH', params: {} });
            expect(d.summary).toContain('Batch of actions');
            expect(d.warnings.some((w) => /no decoded commands/i.test(w))).toBe(true);
        });

        it('composes summaries of sub-commands', () => {
            const d = decodeAction({
                action: 'BATCH',
                params: {
                    COMMANDS: [
                        { action: 'SEND', params: { TICK: 'XCP', AMOUNT: '10', DESTINATION: 'x' } },
                        { action: 'MINT', params: { TICK: 'XCP', AMOUNT: '5' } },
                    ],
                },
                chainId: 'bitcoin-mainnet',
                chainRegistry,
            });
            expect(d.summary).toContain('Batch of 2 actions');
            expect(d.summary).toContain('1. Send');
            expect(d.summary).toContain('2. Mint');
        });

        it('handles malformed sub-command (null)', () => {
            const d = decodeAction({ action: 'BATCH', params: { COMMANDS: [null] } });
            expect(d.warnings.some((w) => /malformed/i.test(w))).toBe(true);
        });

        it('propagates sub-command warnings', () => {
            const d = decodeAction({
                action: 'BATCH',
                params: {
                    COMMANDS: [
                        { action: 'SEND', params: { TICK: 'XCP', AMOUNT: '0', DESTINATION: '' } },
                    ],
                },
            });
            expect(d.warnings.some((w) => /positive/i.test(w))).toBe(true);
        });
    });
    // PC-30. The two standing warnings are the point of this case: they
    // are properties of the protocol (the 24h delay with no retraction,
    // and third parties settling against the quote) rather than of any
    // particular publish, so they must reach the confirm screen no matter
    // which surface composed the action, including the raw one.
    describe('PRICE', () => {
        const v1 = { VERSION: '1', COIN: 'BTC', TICK: 'PEPECASH', FIAT: 'USD', VALUE: '0.05', FEE: '0.01' };

        it('v1 summarizes the published price per unit', () => {
            const d = decodeAction({ action: 'PRICE', params: v1 });
            expect(d.summary).toBe('Publish oracle price 1 PEPECASH = 0.05 USD');
        });

        it('v1 always warns that the price is inert and irrevocable for 24 hours', () => {
            const d = decodeAction({ action: 'PRICE', params: v1 });
            expect(d.warnings.some((w) => /24 hours/.test(w) && /cannot be changed or withdrawn/.test(w))).toBe(true);
        });

        it('v1 always warns that dispensers will sell at this price', () => {
            const d = decodeAction({ action: 'PRICE', params: v1 });
            expect(d.warnings.some((w) => /Dispensers that name this address/.test(w))).toBe(true);
        });

        // FEE is a fraction on the wire; somebody typing 1 meaning "1%"
        // has actually asked for 100%, so show both readings.
        it('v1 renders the usage fee as both fraction and percentage', () => {
            const d = decodeAction({ action: 'PRICE', params: v1 });
            expect(d.details.find((r) => r.label === 'Oracle usage fee').value).toMatch(/0\.01 \(1% of/);
        });

        it('v1 warns on a fee above 1', () => {
            const d = decodeAction({ action: 'PRICE', params: { ...v1, FEE: '1.5' } });
            expect(d.warnings.some((w) => /above 1 \(100%\)/.test(w))).toBe(true);
        });

        it('v1 warns on a non-positive price', () => {
            const d = decodeAction({ action: 'PRICE', params: { ...v1, VALUE: '0' } });
            expect(d.warnings.some((w) => /not a positive number/.test(w))).toBe(true);
        });

        it('v1 warns on a memo with forbidden chars', () => {
            const d = decodeAction({ action: 'PRICE', params: { ...v1, MEMO: 'bad|memo' } });
            expect(d.warnings.some((w) => /Memo contains/.test(w))).toBe(true);
        });

        // v0 is the validator federation snapshot; a wallet cannot publish
        // one, so the confirm screen must say so rather than imply it can.
        it('v0 is flagged as validator-only rather than summarized as signable', () => {
            const d = decodeAction({ action: 'PRICE', params: { VERSION: '0', COIN: 'BTC', FIAT: 'USD', VALUE: '100000' } });
            expect(d.summary).toBe('Validator price snapshot');
            expect(d.warnings.some((w) => /not from a wallet/.test(w))).toBe(true);
        });
    });
});
