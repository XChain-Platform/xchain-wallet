// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AboutSection } from '../../packages/core/src/shared/components/settings/AboutSection.jsx';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { RELEASE_SIGNATURES_DOC } from '../../packages/core/src/buildInfo.js';

afterEach(cleanup);

function about() {
    return render(<MessagingProvider><AboutSection /></MessagingProvider>);
}

/** The row is a list item holding the label and the value, so the link is found from the label. */
function signaturesRow(container) {
    const label = [...container.querySelectorAll('li')]
        .find((el) => el.textContent.startsWith('Release signatures'));
    expect(label, 'About renders a "Release signatures" row').toBeTruthy();
    return label;
}

describe('About: release signatures', () => {
    it('always renders a real external link', () => {
        const { container } = about();
        const row = signaturesRow(container);
        expect(row.textContent).not.toMatch(/not yet published/i);
        const link = row.querySelector('a');
        expect(link, 'the armed row is an anchor a user can follow').toBeTruthy();
        expect(link).toHaveAccessibleName(/Release signatures/);
        expect(link).toHaveTextContent('GPG fingerprint');
    });

    it('points at an absolute URL a browser can open', () => {
        const { container } = about();
        const link = signaturesRow(container).querySelector('a');
        const url = new URL(link.getAttribute('href'));
        expect(url.protocol).toBe('https:');
        expect(link.getAttribute('href')).toBe(RELEASE_SIGNATURES_DOC);
    });

    it('does not point at any in-repo file path', () => {
        const { container } = about();
        const href = signaturesRow(container).querySelector('a').getAttribute('href');
        expect(href).not.toMatch(/RELEASE_SIGNATURES\.md/);
        expect(href).not.toMatch(/^packages\//);
    });

    it('opens the page without handing it a live opener', () => {
        const { container } = about();
        const link = signaturesRow(container).querySelector('a');
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noreferrer noopener');
    });
});
