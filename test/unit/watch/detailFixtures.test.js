// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import validate from '../../../packages/core/src/watch/contract/validate.js';
import { watchChart } from '../../../packages/core/src/watch/watchChart.js';

const schema = JSON.parse(readFileSync(
    'packages/core/src/watch/contract/detail.schema.json',
    'utf8',
));

const loadFixture = (name) => JSON.parse(readFileSync(
    `test/fixtures/watch/${name}.json`,
    'utf8',
));

const fixtures = {
    cached: loadFixture('detail-cached'),
    noArtwork: loadFixture('detail-noart'),
    native: loadFixture('detail-native'),
};

describe('watch detail fixtures', () => {
    it.each(Object.entries(fixtures))('%s conforms to the detail contract', (name, fixture) => {
        expect(validate(schema, fixture), name).toEqual([]);
    });

    it('includes the cached token detail fields', () => {
        const { cached } = fixtures;

        expect(cached).toEqual(expect.objectContaining({
            tokenId: expect.any(String),
            artworkHash: expect.any(String),
            changeText: expect.any(String),
            priceSourceText: expect.any(String),
            facts: expect.any(Array),
            description: expect.any(String),
        }));
        expect(cached.facts.length).toBeGreaterThanOrEqual(4);
        expect([...cached.description].length).toBeGreaterThan(0);
        expect([...cached.description].length).toBeLessThanOrEqual(280);
    });

    it('uses the cached token data without artwork for the no-art variant', () => {
        const { artworkHash, ...cachedWithoutArtwork } = fixtures.cached;

        expect(artworkHash).toEqual(expect.any(String));
        expect(fixtures.noArtwork).toEqual(cachedWithoutArtwork);
        expect(fixtures.noArtwork).not.toHaveProperty('artworkHash');
    });

    it('includes only the listed native detail fields', () => {
        const { native } = fixtures;

        expect(native).toEqual(expect.objectContaining({
            tokenId: expect.any(String),
            changeText: expect.any(String),
            priceSourceText: expect.any(String),
            chart: {
                points: expect.any(Array),
                up: false,
            },
        }));
        expect(native.chart.points).toHaveLength(48);
        expect(native.chart.points.every((point) => point > 0)).toBe(true);
        expect(native.chart.points.every((point, index, points) => (
            index === 0 || point < points[index - 1]
        ))).toBe(true);
        expect(native).not.toHaveProperty('artworkHash');
        expect(native).not.toHaveProperty('facts');
        expect(native).not.toHaveProperty('description');
    });

    it('reproduces the native fixture chart from its points', () => {
        expect(watchChart(fixtures.native.chart.points)).toEqual(fixtures.native.chart);
    });
});
