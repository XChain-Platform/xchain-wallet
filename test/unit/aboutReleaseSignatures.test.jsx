// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The About panel's "Release signatures" row, rendered as it will be AFTER
// the operator arms RELEASE_SIGNATURES_PUBLISHED.
//
// The row is gated off today, so nothing on screen reads the doc constant and
// no test that renders the default state can tell a good target from a
// deleted one. That is exactly how RELEASE_SIGNATURES_DOC came to point at
// `packages/extension/RELEASE_SIGNATURES.md` for as long as it did: the docs
// migration removed the file, the muted "not yet published" hint kept
// rendering, and the dead pointer waited behind a one-word edit.
//
// So the flag is forced true here and the row is asserted in its armed state.
// The DocLink primitive only renders an anchor for an absolute URL; a
// repo-relative path renders as inert text, which is why "is there an <a>"
// is the assertion that catches the regression rather than a string compare.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AboutSection } from '../../packages/core/src/shared/components/settings/AboutSection.jsx';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { RELEASE_SIGNATURES_DOC } from '../../packages/core/src/buildInfo.js';

// Only the flag is faked. The doc constant stays the REAL one, since the
// value under test is where the armed link would actually send a user.
vi.mock('../../packages/core/src/buildInfo.js', async (importOriginal) => ({
    ...(await importOriginal()),
    RELEASE_SIGNATURES_PUBLISHED: true,
}));

afterEach(cleanup);

function about() {
    return render(<MessagingProvider><AboutSection /></MessagingProvider>);
}

/** The row is label + value siblings, so the link is found from the label. */
function signaturesRow(container) {
    const label = [...container.querySelectorAll('span')]
        .find((el) => el.textContent === 'Release signatures');
    expect(label, 'About renders a "Release signatures" row').toBeTruthy();
    return label.parentElement;
}

describe('About: release signatures, with publication armed', () => {
    it('renders a real link rather than the unpublished hint', () => {
        const { container } = about();
        const row = signaturesRow(container);
        expect(row.textContent).not.toMatch(/not yet published/i);
        const link = row.querySelector('a');
        expect(link, 'the armed row is an anchor a user can follow').toBeTruthy();
        expect(link.textContent).toBe('GPG fingerprint');
    });

    it('points at an absolute URL a browser can open', () => {
        const { container } = about();
        const link = signaturesRow(container).querySelector('a');
        // A bare repo path would leave the href relative to whatever origin
        // the shell happens to run on: chrome-extension://<id>/packages/...
        // in the extension, file:// on desktop. Both 404.
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
