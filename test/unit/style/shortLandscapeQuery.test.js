// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const QUERY = '@media (orientation: landscape) and (max-height: 480px) and (min-aspect-ratio: 7/5)';
const FILE_COUNTS = new Map([
    ['packages/core/src/shared/components/AppHeader.module.css', 1],
    ['packages/core/src/shared/components/BottomTabBar.module.css', 1],
    ['packages/core/src/shared/components/LeftNav.module.css', 2],
    ['packages/core/src/shared/components/NoticeModal.module.css', 1],
    ['packages/core/src/shared/components/OverlaySurface.module.css', 1],
    ['packages/core/src/ui/Screen.module.css', 1],
    ['packages/core/src/shared/routes/Locked.module.css', 1],
    ['packages/core/src/shared/routes/MessagingInbox.module.css', 1],
    ['packages/core/src/shared/routes/Onboarding.module.css', 1],
    ['packages/core/src/shared/routes/OnboardingCarousel.module.css', 1],
    ['packages/core/src/shared/routes/Receive.module.css', 1],
]);

describe('short landscape query', () => {
    it('pins all twelve queries to the measured closed-landscape aspect ratio', () => {
        let total = 0;
        for (const [file, expected] of FILE_COUNTS) {
            const css = readFileSync(file, 'utf8');
            const count = css.split(QUERY).length - 1;
            expect(count, file).toBe(expected);
            total += count;
        }
        expect(total).toBe(12);
    });
});
