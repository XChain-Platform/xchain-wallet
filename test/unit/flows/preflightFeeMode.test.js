// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-119: the confirm screen's dry run must ask about the transaction that was
// actually built.
//
// FOUND LIVE, driving campaign §11.3 on Bitcoin regtest. An ISSUE composed with
// "Pay protocol fee in BTC" ON, from an address holding BTC and no XCHAIN, put
// **"Will likely fail: invalid: insufficient funds (FEE)"** on the confirm
// screen and disabled Approve behind the "Sign anyway" override. The action was
// fine. The same endpoint, same action, same source, answers:
//
//     /preflight?...                 -> invalid: insufficient funds (FEE)
//     /preflight?...&feeMode=native  -> valid
//
// because `/preflight` judges against the CHAIN'S DEFAULT lane when no feeMode
// is given, and Bitcoin's default is the XCHAIN debit. The wallet threaded
// `payFeeInNativeCoin` into compose and submit - the coin output really was in
// the PSBT - but never into the dry run that grades it.
//
// WHY IT MATTERS MORE THAN A WRONG LABEL. The person who hits this is exactly
// the person the native lane was built for: someone with no XCHAIN. They are
// told their action will fail, and the only way forward is the override that
// D-112 already showed people will click and pay for. A wallet that cries wolf
// on a correct action is training its users to ignore it on a wrong one.
//
// The two tests below pin both call sites, because the §4.6 Approve-time
// re-check is a SECOND question: one that asked a different one could only
// produce a verdict change nobody could explain.

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useConfirmAction } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';

// The hook opens the flow with confirm(), not run(): confirm() resolves only
// when the user approves, so it is deliberately left un-awaited here - what is
// under test is the dry-run call the hook makes on the way to "ready".

const ACTION_STRING = 'ISSUE|0|NEWTICK|1000|0|0|0';
const PSBT = '70736274ff';

function harness({ payFeeInNativeCoin }) {
    const calls = [];
    const compose = vi.fn(async () => ({
        actionString: ACTION_STRING,
        action: 'ISSUE',
        version: 0,
        psbt: PSBT,
        encoding: 'opreturn',
        carrierScripts: [],
        quote: payFeeInNativeCoin ? { requiredFeeSats: 2000 } : null,
        payFeeInNativeCoin,
    }));
    const preflight = vi.fn(async (args) => {
        calls.push(args);
        return { verdict: 'pass', findings: [], quote: {} };
    });
    return { calls, compose, preflight };
}

async function runConfirm({ payFeeInNativeCoin }) {
    const { calls, compose, preflight } = harness({ payFeeInNativeCoin });
    const { result } = renderHook(() => useConfirmAction());
    await act(async () => {
        result.current.confirm({
            chainId: 'bitcoin-regtest',
            source: 'bcrt1qexample',
            compose,
            preflight,
            onApprove: async () => ({ txid: 'deadbeef' }),
        });
    });
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    return { calls, result };
}

describe('the confirm dry run states the fee lane it composed', () => {
    it('asks in native mode when the PSBT pays the fee in coin', async () => {
        const { calls } = await runConfirm({ payFeeInNativeCoin: true });
        expect(calls[0].feeMode,
            'the dry run was asked about the chain default while the PSBT pays a coin fee output, '
            + 'so a payer with no XCHAIN is told a correct action will fail (D-119)')
            .toBe('native');
    });

    it('states nothing when the fee is not being paid in coin', async () => {
        const { calls } = await runConfirm({ payFeeInNativeCoin: false });
        expect(calls[0].feeMode,
            'an XCHAIN-lane action forced a mode instead of letting the chain default stand')
            .toBeUndefined();
    });
});
