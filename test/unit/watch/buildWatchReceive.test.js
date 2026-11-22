// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { receiveQrUri } from '../../../packages/core/src/shared/utils/receiveQrUri.js';
import { buildWatchReceive } from '../../../packages/core/src/watch/buildWatchReceive.js';
import { qrMatrix } from '../../../packages/core/src/watch/qrMatrix.js';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const BTC_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const LTC_ADDRESS = 'ltc1qg82k2jgm0cjq3svc9aw09rfqccl0fl4a6t8qdx';

describe('buildWatchReceive', () => {
    it('builds one grouped receive entry and matching URI matrix per active chain', () => {
        const registry = defaultRegistry();
        const active = {
            [BTC]: { address: BTC_ADDRESS, label: 'Daily wallet' },
            [LTC]: { address: LTC_ADDRESS },
        };

        const receive = buildWatchReceive(active, registry);

        expect(receive).toHaveLength(2);
        expect(receive[0]).toEqual({
            chainId: BTC,
            label: registry.get(BTC).displayName,
            address: 'bc1q ar0s rrr7 xfkv y5l6 43ly dnw9 re59 gtzz wf5m dq',
            qr: qrMatrix(receiveQrUri({
                descriptor: registry.get(BTC),
                chainId: BTC,
                address: BTC_ADDRESS,
                label: 'Daily wallet',
            })),
        });
        expect(receive[1]).toMatchObject({
            chainId: LTC,
            label: registry.get(LTC).displayName,
            address: 'ltc1 qg82 k2jg m0cj q3sv c9aw 09rf qccl 0fl4 a6t8 qdx',
        });
    });

    it('omits chains without a usable active address or descriptor', () => {
        expect(buildWatchReceive({
            [BTC]: { address: `  ${BTC_ADDRESS}  ` },
            [LTC]: null,
            [DOGE]: { address: '   ' },
            missing: { address: 'unknown' },
        })).toEqual([
            expect.objectContaining({
                chainId: BTC,
                address: 'bc1q ar0s rrr7 xfkv y5l6 43ly dnw9 re59 gtzz wf5m dq',
            }),
        ]);
    });
});
