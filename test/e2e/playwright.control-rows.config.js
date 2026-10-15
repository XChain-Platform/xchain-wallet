// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig, devices } from '@playwright/test';
import layoutConfig from './playwright.layout.config.js';

const WIDTHS = [360, 768, 1280];

export default defineConfig({
    ...layoutConfig,
    testMatch: /control-rows\.spec\.js$/,
    outputDir: './test-results-control-rows',
    projects: WIDTHS.map((width) => ({
        name: `control-rows-${width}`,
        use: {
            ...devices['Desktop Chrome'],
            viewport: { width, height: 900 },
        },
    })),
});
