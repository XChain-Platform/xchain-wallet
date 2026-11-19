// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The license link is a plain body-font link that wraps inside its own box
// with a real space before the arrow, like the other external links.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AboutSection } from '../../../packages/core/src/shared/components/settings/AboutSection.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LICENSE_URL } from '../../../packages/core/src/buildInfo.js';

afterEach(cleanup);

describe('About: license row without a license page', () => {
    it('is an external anchor row to the license file', () => {
        const { container } = render(<MessagingProvider><AboutSection /></MessagingProvider>);
        const link = [...container.querySelectorAll('a')].find((a) => a.textContent.startsWith('License'));
        expect(link).toBeTruthy();
        expect(link.getAttribute('href')).toBe(LICENSE_URL);
        expect(link).toHaveTextContent('Free software under the GNU AGPL v3.0 or later.');
        expect(link.target).toBe('_blank');
        expect(link.rel).toBe('noreferrer noopener');
    });
});
