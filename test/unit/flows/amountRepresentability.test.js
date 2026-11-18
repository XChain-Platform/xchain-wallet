// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Where the newer amount rule is unarmed, the wallet judges its own amounts with
// the SDK's validator and drops AMOUNT_REPRESENTABILITY only when every amount
// passes (operator ruling 2026-11-17). Anything unreadable keeps the item.

import { describe, expect, it } from 'vitest';
import {
    actionAmounts,
    amountRulesFromSdk,
    settleAmountRepresentability,
} from '../../../packages/core/src/flows/amountRepresentability.js';
import { PREFLIGHT_CHECK_STATES, preflightCheckState } from '../../../packages/core/src/shared/utils/preflightCheckState.js';
import { requireSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';

const installed = sdkInstalled();
const rules = installed
    ? amountRulesFromSdk({ numeric: requireSdkDeep('preflightNumeric'), amountFormat: requireSdkDeep('preflightAmountFormat') })
    : null;
const decoder = installed ? requireSdkDeep('decoder') : null;
const engine = installed ? requireSdkDeep('preflightEngine') : null;
const S = PREFLIGHT_CHECK_STATES;

const APPROVAL = { code: 'DRYRUN_VALID', severity: 'info', source: 'dryrun', message: 'ok', data: {} };
const AMOUNT_ITEM = { check: 'AMOUNT_REPRESENTABILITY', reason: 'declared where the rule is unarmed' };
const XCP = { tick: 'XCP', info: { tick: 'XCP', decimals: 8 }, supply: { max: '1000000', current: '400', decimals: 8 }, max_mint: '10' };

const reportWith = (unverified) => ({ verdict: 'pass', restricted: false, findings: [APPROVAL], unverified });
const tokens = (rows) => async (tick) => (tick in rows ? rows[tick] : null);

describe.skipIf(!installed)('settleAmountRepresentability', () => {
    const settle = (report, actionString, rows = { XCP }) => settleAmountRepresentability(report, {
        parsed: decoder.parse(actionString), rules, tokenFor: tokens(rows),
    });

    it('reads the validator pair off the SDK modules', () => {
        expect(rules).not.toBeNull();
        expect(amountRulesFromSdk({})).toBeNull();
        expect(amountRulesFromSdk({ numeric: { default: requireSdkDeep('preflightNumeric') }, amountFormat: requireSdkDeep('preflightAmountFormat') }))
            .not.toBeNull();
    });

    it('turns a mainnet send whose only gap is the amount rule into a pass', async () => {
        const report = reportWith([AMOUNT_ITEM]);
        expect(preflightCheckState(report)).toBe(S.PARTIAL);
        const settled = await settle(report, 'SEND|0|XCP|1.5|bc1qdest');
        expect(settled.unverified).toEqual([]);
        expect(preflightCheckState(settled)).toBe(S.PASS);
        // The SDK's report is shared by the coalescer, so it stays as built.
        expect(report.unverified).toEqual([AMOUNT_ITEM]);
    });

    it.each([
        ['an exponent', 'SEND|0|XCP|1e2|bc1qdest'],
        ['more fraction digits than the token has', 'SEND|0|XCP|1.123456789|bc1qdest'],
        ['more than 42 integer digits', `SEND|0|XCP|${'9'.repeat(43)}|bc1qdest`],
        ['a radix prefix', 'SEND|0|XCP|0x10|bc1qdest'],
        ['a sign', 'SEND|0|XCP|+1|bc1qdest'],
        ['a joined leg list', 'SEND|0|XCP|1,2|bc1qdest'],
    ])('keeps the item, partial and red, for %s', async (_label, actionString) => {
        const report = reportWith([AMOUNT_ITEM]);
        const settled = await settle(report, actionString);
        expect(settled).toBe(report);
        expect(preflightCheckState(settled)).toBe(S.PARTIAL);
    });

    it('keeps every other unverified item, so a failed read stays partial', async () => {
        const failedRead = { check: 'TOKEN_LOOKUP', reason: 'timeout of 8000ms exceeded' };
        const settled = await settle(reportWith([AMOUNT_ITEM, failedRead]), 'SEND|0|XCP|1|bc1qdest');
        expect(settled.unverified).toEqual([failedRead]);
        expect(preflightCheckState(settled)).toBe(S.PARTIAL);
    });

    it('judges an ISSUE at the token row decimals, else the wire DECIMALS', async () => {
        const fresh = await settle(reportWith([AMOUNT_ITEM]), 'ISSUE|0|NEWTOK|1000|10|2|x|1000', {});
        expect(fresh.unverified).toEqual([]);
        const tooFine = reportWith([AMOUNT_ITEM]);
        expect(await settle(tooFine, 'ISSUE|0|NEWTOK|1000.5||0||1000', {})).toBe(tooFine);
        // An edit is judged at the row: XCP carries 8 decimals whatever the wire says.
        const edit = await settle(reportWith([AMOUNT_ITEM]), 'ISSUE|0|XCP|1000.25||0||');
        expect(edit.unverified).toEqual([]);
        // A callback amount is measured against another tick, so the wallet cannot say.
        const callback = reportWith([AMOUNT_ITEM]);
        expect(await settle(callback, 'ISSUE|0|NEWTOK|1000||0||1000|||||||||OTHER|5', {})).toBe(callback);
    });

    it('reads an explorer 404 as an absent token and any other failure as unknown', async () => {
        const report = reportWith([AMOUNT_ITEM]);
        const absent = async () => { throw Object.assign(new Error('404'), { code: 'EXPLORER_HTTP_404' }); };
        const settledIssue = await settleAmountRepresentability(report, {
            parsed: decoder.parse('ISSUE|0|NEWTOK|1000||0||1000'), rules, tokenFor: absent,
        });
        expect(settledIssue.unverified).toEqual([]);
        expect(await settleAmountRepresentability(report, {
            parsed: decoder.parse('SEND|0|XCP|1|bc1qdest'), rules, tokenFor: absent,
        })).toBe(report);
    });

    it('drops the item beside MINT_ADDRESS_HEADROOM, leaving the blue settle-time note', async () => {
        const headroom = { check: 'MINT_ADDRESS_HEADROOM', reason: 'server-side only' };
        const settled = await settle(reportWith([AMOUNT_ITEM, headroom]), 'MINT|0|XCP|1');
        expect(settled.unverified).toEqual([headroom]);
        expect(preflightCheckState(settled)).toBe(S.SETTLE_CHECKS);
    });

    it('judges each amount against its own tick, DIVIDEND against the paid tick', async () => {
        const WHOLE = { tick: 'WHOLE', info: { decimals: 0 } };
        const ok = await settle(reportWith([AMOUNT_ITEM]), 'DIVIDEND|0|XCP|WHOLE|3', { XCP, WHOLE });
        expect(ok.unverified).toEqual([]);
        const frac = reportWith([AMOUNT_ITEM]);
        expect(await settle(frac, 'DIVIDEND|0|XCP|WHOLE|0.5', { XCP, WHOLE })).toBe(frac);
    });

    it('keeps the item when it cannot tell which amounts the action carries', async () => {
        const report = reportWith([AMOUNT_ITEM]);
        // Unlisted actions, batches and other versions.
        expect(await settle(report, 'ORDER|0|XCP|1|ABC|2|100')).toBe(report);
        expect(await settle(report, 'BATCH|0|SEND|0|XCP|1|bc1q;MINT|0|XCP|1')).toBe(report);
        expect(await settle(report, 'SEND|1|XCP|1|bc1qdest')).toBe(report);
        // A token the explorer does not know, a failed lookup, a row without decimals.
        expect(await settle(report, 'SEND|0|NOPE|1|bc1qdest')).toBe(report);
        expect(await settleAmountRepresentability(report, {
            parsed: decoder.parse('SEND|0|XCP|1|bc1qdest'), rules, tokenFor: async () => { throw new Error('down'); },
        })).toBe(report);
        expect(await settle(report, 'SEND|0|XCP|1|bc1qdest', { XCP: { tick: 'XCP' } })).toBe(report);
        // No validator (a harness without the SDK) or no parse.
        expect(await settleAmountRepresentability(report, { parsed: decoder.parse('SEND|0|XCP|1|bc1qdest'), rules: null, tokenFor: tokens({ XCP }) }))
            .toBe(report);
        expect(await settleAmountRepresentability(report, { parsed: null, rules, tokenFor: tokens({ XCP }) })).toBe(report);
    });

    it('reads token rows in the explorer shapes the SDK unwraps', async () => {
        for (const row of [XCP, { data: XCP }, [XCP]]) {
            const settled = await settle(reportWith([AMOUNT_ITEM]), 'SEND|0|XCP|1|bc1qdest', { XCP: row });
            expect(settled.unverified).toEqual([]);
        }
    });

    it('leaves a report without the item untouched and asks the explorer nothing', async () => {
        let asked = 0;
        const report = reportWith([{ check: 'SEND_RESTRICTIONS', reason: 'server-side only' }]);
        const out = await settleAmountRepresentability(report, {
            parsed: decoder.parse('SEND|0|XCP|1|bc1qdest'), rules, tokenFor: async () => { asked += 1; return XCP; },
        });
        expect(out).toBe(report);
        expect(asked).toBe(0);
        expect(await settleAmountRepresentability(null, { rules })).toBeNull();
    });

    it('pairs legs by index and repeats the last tick', () => {
        expect(actionAmounts({ ok: true, action: 'SEND', version: 0, params: { TICK: ['A', 'B'], AMOUNT: ['1', '2', '3'] } }))
            .toEqual([{ tick: 'A', amount: '1' }, { tick: 'B', amount: '2' }, { tick: 'B', amount: '3' }]);
        expect(actionAmounts({ ok: true, action: 'SEND', version: 0, params: { TICK: '', AMOUNT: '1' } })).toBeNull();
        expect(actionAmounts({ ok: true, action: 'SEND', version: 0, params: { TICK: 'A' } })).toBeNull();
    });
});

// The report the wallet's own SDK builds against a stub explorer that approves
// the action, on each plane. Mainnet declares the rule; regtest and testnet arm it.
describe.skipIf(!engine)('settleAmountRepresentability on the SDK report', () => {
    const sdkOn = (network, coin) => ({
        config: { network },
        _preflightCoalescer: { run: (_key, producer) => producer() },
        explorer: {
            coin,
            getToken: async () => XCP,
            getBalances: async () => ({ data: [{ tick: 'XCP', quantity: '1000' }] }),
            getPreflight: async () => ({ supported: true, valid: true, status: 'valid' }),
        },
    });
    const run = async (network, coin, actionString) => {
        const sdk = sdkOn(network, coin);
        const report = await engine.runPreflight(sdk, actionString, { source: 'bc1qfixture', preflight: 'report' });
        const settled = await settleAmountRepresentability(report, {
            parsed: decoder.parse(actionString), rules, tokenFor: (tick) => sdk.explorer.getToken(tick),
        });
        return { report, settled, checks: (r) => r.unverified.map((u) => u.check) };
    };

    it('drops the item from a mainnet mint and leaves the settle-time gap', async () => {
        const { report, settled, checks } = await run('mainnet', 'BTC', 'MINT|0|XCP|1');
        expect(report.verdict).toBe('pass');
        expect(checks(report)).toEqual(['AMOUNT_REPRESENTABILITY', 'MINT_ADDRESS_HEADROOM']);
        expect(checks(settled)).toEqual(['MINT_ADDRESS_HEADROOM']);
        expect(preflightCheckState(settled)).toBe(S.SETTLE_CHECKS);
    });

    it('drops the item from a mainnet send, leaving its settle-time declarations', async () => {
        const { report, settled, checks } = await run('mainnet', 'BTC', 'SEND|0|XCP|1.5|bc1qdest');
        expect(checks(report)).toContain('AMOUNT_REPRESENTABILITY');
        expect(checks(settled)).toEqual(checks(report).filter((c) => c !== 'AMOUNT_REPRESENTABILITY'));
        expect(preflightCheckState(settled)).toBe(S.SETTLE_CHECKS);
    });

    it('keeps the item on a mainnet send in exponent form, which the legacy rule passes', async () => {
        const { report, settled } = await run('mainnet', 'BTC', 'SEND|0|XCP|1e2|bc1qdest');
        expect(report.verdict).toBe('pass');
        expect(settled).toBe(report);
    });

    it.each([['regtest', 'RBTC'], ['testnet', 'TBTC']])('leaves the %s report as the SDK built it', async (network, coin) => {
        for (const actionString of ['MINT|0|XCP|1', 'SEND|0|XCP|1.5|bc1qdest']) {
            const { report, settled, checks } = await run(network, coin, actionString);
            expect(checks(report)).not.toContain('AMOUNT_REPRESENTABILITY');
            expect(settled).toBe(report);
        }
    });
});
