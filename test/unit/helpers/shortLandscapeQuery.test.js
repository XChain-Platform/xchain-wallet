// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    listShortLandscapeQueries,
    matchesShortLandscape,
    parseShortLandscapeQuery,
} from '../../helpers/shortLandscapeQuery.js';

const EXPECTED_FILES = [
    'packages/core/src/shared/components/AppHeader.module.css',
    'packages/core/src/shared/components/BottomTabBar.module.css',
    'packages/core/src/shared/components/LeftNav.module.css',
    'packages/core/src/shared/components/NoticeModal.module.css',
    'packages/core/src/shared/components/OverlaySurface.module.css',
    'packages/core/src/shared/routes/Locked.module.css',
    'packages/core/src/shared/routes/MessagingInbox.module.css',
    'packages/core/src/shared/routes/Onboarding.module.css',
    'packages/core/src/shared/routes/OnboardingCarousel.module.css',
    'packages/core/src/shared/routes/Receive.module.css',
    'packages/core/src/ui/Screen.module.css',
];

describe('short landscape query helpers', () => {
    it('parses landscape queries with an optional aspect ratio', () => {
        expect(parseShortLandscapeQuery(
            '@media (orientation: landscape) and (max-height: 480px) and (min-aspect-ratio: 3/2) {',
        )).toEqual({ maxHeight: 480, minAspect: 1.5 });
        expect(parseShortLandscapeQuery(
            '@media (max-height: 480px) and (orientation: landscape) {',
        )).toEqual({ maxHeight: 480, minAspect: undefined });
        expect(parseShortLandscapeQuery('@media (max-height: 480px) {')).toBeNull();
        expect(parseShortLandscapeQuery('@media (orientation: landscape) and (max-height: 30rem) {')).toBeNull();
    });

    it('lists the twelve queries in the eleven WD-179 files with one aspect clause', () => {
        const queries = listShortLandscapeQueries(process.cwd());
        const files = [...new Set(queries.map(({ file }) => file))].sort();
        const aspects = new Set(queries.map(({ query }) => parseShortLandscapeQuery(query).minAspect));

        expect(queries.length).toBeGreaterThanOrEqual(12);
        expect(files).toEqual(EXPECTED_FILES);
        expect(aspects.size).toBe(1);
        expect([...aspects][0]).toBeTypeOf('number');
        expect(queries.every(({ line }) => Number.isInteger(line) && line > 0)).toBe(true);
    });

    it.each([
        [{ width: 844, height: 390 }, true, true],
        [{ width: 678, height: 466 }, false, true],
        [{ width: 360, height: 317 }, false, false],
        [{ width: 466, height: 678 }, false, false],
        [{ width: 1024, height: 700 }, false, false],
    ])('matches the target size %o', (size, matchesThreeHalves, matchesSevenFifths) => {
        expect(matchesShortLandscape(size, { maxHeight: 480, minAspect: 3 / 2 })).toBe(matchesThreeHalves);
        expect(matchesShortLandscape(size, { maxHeight: 480, minAspect: 7 / 5 })).toBe(matchesSevenFifths);
    });

    it('applies max height when the aspect clause is absent', () => {
        const parsed = { maxHeight: 480, minAspect: undefined };
        expect(matchesShortLandscape({ width: 500, height: 480 }, parsed)).toBe(true);
        expect(matchesShortLandscape({ width: 500, height: 481 }, parsed)).toBe(false);
    });
});
