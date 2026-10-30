// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The License row's link is a plain body-font link that wraps inside its own
// box with a real space before the arrow, like the other external links.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AboutSection } from '../../../packages/core/src/shared/components/settings/AboutSection.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LICENSE_NAME } from '../../../packages/core/src/buildInfo.js';

afterEach(cleanup);

describe('About: license link', () => {
    it('is a body-font inline-block link with a space before the arrow', () => {
        const { container } = render(<MessagingProvider><AboutSection /></MessagingProvider>);
        const link = [...container.querySelectorAll('a')].find((a) => a.textContent.startsWith(LICENSE_NAME));
        expect(link).toBeTruthy();
        expect(link.style.fontFamily).toBe('');
        expect(link.style.display).toBe('inline-block');
        expect(link.style.textAlign).toBe('start');
        expect(link.textContent).toBe(`${LICENSE_NAME} ↗`);
    });
});
