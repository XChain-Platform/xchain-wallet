// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROUTE_REGISTRY } from '../../../packages/core/src/shared/routeRegistry.js';

const shellApps = [
    'packages/web/src/App.jsx',
    'packages/extension/src/popup/App.jsx',
    'packages/desktop/renderer/App.jsx',
];

describe('retired resume confirmation route', () => {
    it('is absent from the shared registry and every shell', () => {
        const routes = Object.values(ROUTE_REGISTRY).map((route) => route.id);
        expect(routes).not.toContain('resume-confirm');

        for (const path of shellApps) {
            const source = readFileSync(path, 'utf8');
            expect(source).not.toContain('ResumeConfirm');
            expect(source).not.toContain('resume-confirm');
            expect(source).not.toContain('onResumeConfirm');
        }
    });
});
