// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import {
    buildWatchReceive,
    groupAddress,
} from '../../../packages/core/src/watch/buildWatchReceive.js';
import validate from '../../../packages/core/src/watch/contract/validate.js';
import { checkFixtureFile } from '../../helpers/watchFixtureFile.js';

const fixturePath = 'test/fixtures/watch/receive-chains.json';
const schema = JSON.parse(readFileSync(
    'packages/core/src/watch/contract/receive.schema.json',
    'utf8',
));
const active = {
    'bitcoin-mainnet': {
        address: 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd',
        label: 'Daily wallet',
    },
    'litecoin-mainnet': {
        address: 'ltc1qg82k2jgm0cjq3svc9aw09rfqccl0fl4a6t8qdx',
    },
    'dogecoin-mainnet': {
        address: 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L',
    },
};

describe('watch receive fixture', () => {
    it('rebuilds byte-identically', () => {
        const generated = buildWatchReceive(active, defaultRegistry());

        expect(checkFixtureFile(fixturePath, generated)).toEqual({ status: 'same' });
    });

    it('conforms to the receive contract', () => {
        const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

        expect(validate(schema, fixture)).toEqual([]);
    });

    it('pins chain order, registry labels, grouped addresses and varied QR sizes', () => {
        const registry = defaultRegistry();
        const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
        const activeEntries = Object.entries(active);

        expect(fixture).toHaveLength(3);
        expect(fixture.map(({ chainId }) => chainId)).toEqual(activeEntries.map(([chainId]) => chainId));
        expect(new Set(fixture.map(({ chainId }) => chainId)).size).toBe(3);

        for (const [index, [chainId, entry]] of activeEntries.entries()) {
            expect(fixture[index]).toMatchObject({
                chainId,
                label: registry.get(chainId).displayName,
                address: groupAddress(entry.address),
            });
        }

        expect(new Set(fixture.map(({ qr }) => qr.size)).size).toBeGreaterThanOrEqual(2);
    });
});
