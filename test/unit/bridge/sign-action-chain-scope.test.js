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
// assertChainPermitted validate req.chainId, so the flow call must be
// built with `...params` spread FIRST and the trusted keys (chainId,
// vault, password, registries) set AFTER it. With the spread last, a
// site connected for one chain could pass params.chainId and have the
// signed action execute on any chain in the registry, bypassing the
// per-chain permission scope the user approved.
//
// Same compile-time source-scanning pattern as sign-in-challenge.test.js.

import { describe, it, expect } from 'vitest';
import handlersSource from '../../../packages/extension/src/bridge/handlers.js?raw';

// Capture each flow call's argument object and assert key order inside it.
function flowCallBody(flowName) {
    const m = handlersSource.match(
        new RegExp(`return ${flowName}\\(\\{([\\s\\S]*?)\\}\\);`),
    );
    expect(m, `${flowName}({...}) call site found`).not.toBeNull();
    return m[1];
}

describe('bridge.signAction: dApp params cannot override the approved chainId', () => {
    for (const flow of ['sendToken', 'sweepToken']) {
        it(`${flow} spreads dApp params first, then sets the trusted keys`, () => {
            const body = flowCallBody(flow);
            const spreadAt = body.indexOf('...params');
            const chainIdAt = body.indexOf('chainId: req.chainId');
            const vaultAt = body.indexOf('vault: deps.vault');
            const passwordAt = body.indexOf('password: decision.password');
            expect(spreadAt, `${flow} spreads ...params`).toBeGreaterThan(-1);
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
            const spreadAt = body.indexOf('...params');
            const trackAt = body.indexOf('trackPendingTx: true');
            expect(spreadAt, `${flow} spreads ...params`).toBeGreaterThan(-1);
            expect(trackAt, `${flow} sets trackPendingTx: true`).toBeGreaterThan(-1);
            expect(trackAt).toBeGreaterThan(spreadAt);
        });
    }
});
