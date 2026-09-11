// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: bridge.signAction chain-scope integrity.
//
// req.params is fully dApp-controlled. The approval popup and
// assertChainPermitted validate req.chainId, so the flow call must spread the
// dApp-derived params FIRST and set the trusted keys (chainId, vault, password,
// registries) AFTER. With the spread last, a site connected for one chain could
// pass params.chainId and have the signed action execute on any chain in the
// registry, bypassing the per-chain permission scope the user approved.
//
// The spread is not `...params` itself: page params reach the flow only
// through pickFlowParams(), an approval-payload-shaped allowlist. Ordering still
// matters (the allowlist can gain a key), so these assertions anchor on whatever
// the call spreads rather than on a literal, and the allowlist assertions at
// the bottom pin the stronger property directly.
//
// Same compile-time source-scanning pattern as sign-in-challenge.test.js.

import { describe, it, expect } from 'vitest';
import handlersSource from '../../../packages/extension/src/bridge/handlers.js?raw';

// Offset of the dApp-derived spread inside a flow call's argument object.
function paramSpreadIndex(body) {
    const m = body.match(/\.\.\.\s*(?:params\b|pickFlowParams\()/);
    return m ? m.index : -1;
}

// Capture each flow call's argument object and assert key order inside it.
//
// Anchored on the CALL, not on `return <flow>(`: the flow result is now shaped
// into the bridge-spec SignActionResult before it leaves the handler
//, so the call site is `const submitted = await sendToken({…})`.
// The guard is on the argument object's key order either way.
function flowCallBody(flowName) {
    const m = handlersSource.match(
        new RegExp(`\\b${flowName}\\(\\{([\\s\\S]*?)\\}\\);`),
    );
    expect(m, `${flowName}({...}) call site found`).not.toBeNull();
    return m[1];
}

describe('bridge.signAction: dApp params cannot override the approved chainId', () => {
    for (const flow of ['sendToken', 'sweepToken']) {
        it(`${flow} spreads dApp params first, then sets the trusted keys`, () => {
            const body = flowCallBody(flow);
            const spreadAt = paramSpreadIndex(body);
            const chainIdAt = body.indexOf('chainId: req.chainId');
            const vaultAt = body.indexOf('vault: deps.vault');
            const passwordAt = body.indexOf('password: decision.password');
            expect(spreadAt, `${flow} spreads the dApp-derived params`).toBeGreaterThan(-1);
            expect(chainIdAt, `${flow} sets chainId from req`).toBeGreaterThan(-1);
            // Trusted keys must come AFTER the dApp-controlled spread so they win.
            expect(chainIdAt).toBeGreaterThan(spreadAt);
            expect(vaultAt).toBeGreaterThan(spreadAt);
            expect(passwordAt).toBeGreaterThan(spreadAt);
        });
    }
});

// Regression: bridge.signAction pre-spend audit integrity.
//
// trackPendingTx is not a protocol param, it is an internal control flag
// (sendToken.js / sweepToken.js) that gates whether submitAction writes the
// pre-spend PendingTx audit row before broadcasting. Left inside the dApp
// params spread, a connected site could send `trackPendingTx: false` and
// get a user-approved spend that leaves no audit record and disables the
// BroadcastFailedError recovery path. It must be re-applied as a trusted
// key AFTER the spread, exactly like chainId/vault/password above.
describe('bridge.signAction: dApp params cannot suppress the pre-spend audit record', () => {
    for (const flow of ['sendToken', 'sweepToken']) {
        it(`${flow} forces trackPendingTx:true after the dApp params spread`, () => {
            const body = flowCallBody(flow);
            const spreadAt = paramSpreadIndex(body);
            const trackAt = body.indexOf('trackPendingTx: true');
            expect(spreadAt, `${flow} spreads the dApp-derived params`).toBeGreaterThan(-1);
            expect(trackAt, `${flow} sets trackPendingTx: true`).toBeGreaterThan(-1);
            expect(trackAt).toBeGreaterThan(spreadAt);
        });
    }
});

// Regression: bridge.signAction confirm-what-you-sign integrity.
//
// Key order alone is not enough. The trusted keys re-applied after the spread
// are only the ones the handler names, so any OTHER internal option a page
// invents survives it. Two of them change what is signed while the approval
// payload keeps describing the same to/tick/amount:
//   - `legs` wins over to/tick/amount inside normalizeSendLegs, so an approval
//     for one recipient and amount signs a different recipient and amount;
//   - `prebuiltPsbt` is handed to submitWithSigner, which signs those bytes
//     verbatim with no rebuild, on the assumption the confirm pipeline composed
//     and previewed them. The bridge composes nothing.
// So the flow call takes an ALLOWLIST of previewed fields, and the two keys
// above are refused before the user is ever prompted.
describe('bridge.signAction: page params cannot diverge the signature from the approval', () => {
    const allowlist = handlersSource.match(/const FLOW_PARAM_ALLOWLIST = \{([\s\S]*?)\};/);
    const forbidden = handlersSource.match(/const FORBIDDEN_FLOW_PARAMS = \[([\s\S]*?)\];/);

    it('the flow call takes an allowlist rather than the raw page params', () => {
        for (const flow of ['sendToken', 'sweepToken']) {
            const body = flowCallBody(flow);
            expect(body, `${flow} must not spread raw page params`).not.toMatch(/\.\.\.\s*params\b/);
            expect(body, `${flow} spreads the allowlisted subset`).toMatch(/\.\.\.\s*pickFlowParams\(/);
        }
    });

    it('the allowlist carries only fields the approval screen renders', () => {
        expect(allowlist, 'FLOW_PARAM_ALLOWLIST declared').not.toBeNull();
        // Every key the approval payload does NOT display, and every trusted key
        // re-applied after the spread, must be absent: an allowlisted `fee`,
        // `chainId` or `trackPendingTx` would hand the page back what the
        // ordering guard above takes away.
        for (const key of ['legs', 'prebuiltPsbt', 'fee', 'feePerKb', 'rbf', 'signer',
            'chainId', 'vault', 'walletId', 'password', 'trackPendingTx',
            'from', 'to', 'tick', 'amount', 'reservationLedger']) {
            expect(allowlist[1], `allowlist must not carry ${key}`)
                .not.toMatch(new RegExp(`['"\`]${key}['"\`]`));
        }
        // The previewed fields must still get through, or the bridge silently
        // drops what the user was shown.
        //
        // Asserted PER ACTION, not against the whole literal. Matching /'memo'/
        // anywhere stayed green while `memo` sat on SEND alone and SWEEP
        // stripped it, after approvalPayload's `common` had already rendered
        // MEMO on the sweep approval screen and sweepToken was ready to sign
        // it: a shown-but-not-signed divergence hiding behind a passing guard.
        const entryFor = (action) => {
            const m = allowlist[1].match(new RegExp(`${action}\\s*:\\s*\\[([^\\]]*)\\]`));
            expect(m, `${action} entry present in FLOW_PARAM_ALLOWLIST`).not.toBeNull();
            return m[1];
        };
        for (const action of ['SEND', 'SWEEP'])
            expect(entryFor(action), `${action} renders MEMO on its approval screen, so it must survive`)
                .toMatch(/'memo'/);
        for (const flag of ['balances', 'ownerships', 'orders', 'swaps', 'dispensers'])
            expect(entryFor('SWEEP'), `SWEEP flag ${flag} is rendered and must survive`)
                .toMatch(new RegExp(`'${flag}'`));
    });

    it('legs and prebuiltPsbt are refused, and refused before the approval prompt', () => {
        expect(forbidden, 'FORBIDDEN_FLOW_PARAMS declared').not.toBeNull();
        expect(forbidden[1]).toMatch(/'legs'/);
        expect(forbidden[1]).toMatch(/'prebuiltPsbt'/);
        // Order inside executeSignAction: the shape check must precede the
        // approvals.signAction prompt, so a divergent request never renders a
        // screen that describes something else.
        const assertAt = handlersSource.indexOf('assertNoSigningDivergenceParams(params)');
        const promptAt = handlersSource.indexOf('await approvals.signAction({');
        expect(assertAt, 'the shape check is called').toBeGreaterThan(-1);
        expect(promptAt, 'the approval prompt is called').toBeGreaterThan(-1);
        expect(assertAt).toBeLessThan(promptAt);
    });
});
