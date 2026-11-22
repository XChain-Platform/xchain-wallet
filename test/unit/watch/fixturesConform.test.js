// @vitest-environment node
// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    explainMessage,
    schemas,
    validateMessage,
} from '../../../packages/core/src/watch/contract/index.js';

const fixtureRoot = 'test/fixtures/watch';
const snapshotNames = [
    'snapshot-empty',
    'snapshot-testnet',
    'snapshot-unpriced',
    'snapshot-hidden',
    'snapshot-stale',
    'snapshot-stale24',
    'snapshot-locked',
    'snapshot-rows50',
    'snapshot-longnames',
    'snapshot-capped',
    'snapshot-disabled',
];
const detailNames = [
    'detail-cached',
    'detail-noart',
    'detail-loaderror',
    'detail-native',
];

const loadFixture = (name) => JSON.parse(readFileSync(
    `${fixtureRoot}/${name}.json`,
    'utf8',
));

describe('watch fixtures', () => {
    it.each([
        ...snapshotNames.map((name) => [name, 'snapshot']),
        ...detailNames.map((name) => [name, 'detail']),
    ])('%s conforms to the %s contract', (name, kind) => {
        const fixture = loadFixture(name);

        expect(explainMessage(kind, fixture), name).toEqual([]);
        expect(validateMessage(kind, fixture), name).toBe(true);
    });

    it.each(snapshotNames)('%s stays within the snapshot byte budget', (name) => {
        const contents = readFileSync(`${fixtureRoot}/${name}.json`);

        expect(contents.byteLength, name).toBeLessThanOrEqual(schemas.snapshot['x-budgetBytes']);
    });

    it('pins the balance scenario boundaries', () => {
        const empty = loadFixture('snapshot-empty');
        const testnet = loadFixture('snapshot-testnet');
        const unpriced = loadFixture('snapshot-unpriced');
        const hidden = loadFixture('snapshot-hidden');
        const stale = loadFixture('snapshot-stale');
        const stale24 = loadFixture('snapshot-stale24');
        const locked = loadFixture('snapshot-locked');
        const longNames = loadFixture('snapshot-longnames');
        const disabled = loadFixture('snapshot-disabled');

        expect(empty.rows).toEqual([]);
        expect(testnet).toMatchObject({
            network: { kind: 'testnet', isTest: true },
            unitDefault: 'units',
        });
        expect(unpriced.rows[0]).toMatchObject({ noPrice: true, fiatText: 'No price yet' });
        expect(hidden.hidden).toBe(true);
        expect(stale.builtAt - stale.balancesAt).toBe(16 * 60 * 1000);
        expect(stale24.builtAt - stale24.balancesAt).toBe(24 * 60 * 60 * 1000);
        expect(locked.session).toBe('locked');
        expect(loadFixture('snapshot-rows50')).toMatchObject({
            capped: false,
            rows: { length: 50 },
        });
        expect(loadFixture('snapshot-capped')).toMatchObject({
            capped: true,
            rows: { length: 50 },
        });
        expect([...longNames.walletName]).toHaveLength(40);
        expect([...longNames.rows[0].displayName]).toHaveLength(64);
        expect(disabled).toMatchObject({
            rows: [],
            receive: [],
            inbox: [],
            settings: { enabled: false },
        });
    });

    it('pins cached, missing and native detail variants', () => {
        const cached = loadFixture('detail-cached');
        const noArtwork = loadFixture('detail-noart');
        const native = loadFixture('detail-native');

        expect(cached).toMatchObject({
            artworkHash: expect.any(String),
            facts: { length: 5 },
        });
        const { artworkHash, ...cachedWithoutArtwork } = cached;
        expect(artworkHash).toBeTruthy();
        expect(noArtwork).toEqual(cachedWithoutArtwork);
        expect(loadFixture('detail-loaderror')).toEqual({
            v: 1,
            tokenId: 'bitcoin-mainnet:LOADERROR',
        });
        expect(native).toMatchObject({
            chart: { points: { length: 48 }, up: false },
        });
        expect(native.chart.points.every((point) => point > 0)).toBe(true);
        expect(native.chart.points.every((point, index, points) => (
            index === 0 || point < points[index - 1]
        ))).toBe(true);
        expect(native).not.toHaveProperty('artworkHash');
        expect(native).not.toHaveProperty('facts');
        expect(native).not.toHaveProperty('description');
    });
});
