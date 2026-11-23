// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Compile-time conformance fixture, checked by this package's typecheck and
// never imported at runtime. The published typed action params must be
// accepted by the batch method exactly as signAction accepts them, including
// a batch that mixes action kinds.

import type {
    SendActionParams,
    SignActionParams,
    SignActionResult,
    SweepActionParams,
    XChainProvider,
} from '@xchain-wallet/bridge-spec';
import type { MockXChainProvider } from './mock-provider.ts';

export async function bridgeSpecConformance(
    provider: XChainProvider,
    mock: MockXChainProvider,
): Promise<void> {
    const send: SignActionParams<SendActionParams> = {
        chainId: 'bitcoin-regtest',
        action: 'SEND',
        params: { fromAddress: 'a', toAddress: 'b', asset: 'BTC', amountRaw: '1000' },
    };
    const sweep: SignActionParams<SweepActionParams> = {
        chainId: 'bitcoin-regtest',
        action: 'SWEEP',
        params: { fromAddress: 'a', toAddress: 'b' },
    };
    const untyped: SignActionParams = { chainId: 'bitcoin-regtest', action: 'SEND', params: {} };

    for (const target of [provider, mock] as const) {
        await target.signAction(send);
        await target.signAction(sweep);
        await target.parallel([send]);
        await target.parallel([sweep]);
        await target.parallel([send, sweep]);
        await target.parallel([send, sweep] as const);
        await target.parallel([send, untyped]);
        const results: SignActionResult[] = await target.parallel([send, sweep]);
        void results;
    }
    // @ts-expect-error a batch entry without chainId is still refused
    await provider.parallel([{ action: 'SEND', params: {} }]);
}
