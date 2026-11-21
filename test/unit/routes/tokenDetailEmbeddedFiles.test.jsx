// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A token file can carry its whole body inline as a data: URL. The Files tab
// card must never print that payload (heading, URL line, alt or aria text);
// it shows a short label instead, draws the picture as a thumbnail only when
// the wallet's image rule (safeImageSrc) already admits it, and leaves an
// ordinary https file exactly as before.

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PublicFileTile, tokenFileEntries } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { embeddedDataLabel, isDataUrl } from '../../../packages/core/src/shared/utils/embeddedDataLabel.js';

// 1,200 bytes of SVG text as base64 (1,600 characters, no padding).
const SVG_BYTES = `<svg xmlns="http://www.w3.org/2000/svg">${'x'.repeat(1200 - 46)}</svg>`;
const SVG_B64 = Buffer.from(SVG_BYTES).toString('base64');
const SVG_DATA_URL = `data:image/svg+xml;base64,${SVG_B64}`;
const UTF8_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>PASS</text></svg>')}`;

const entry = (extra = {}) => ({
    url: null, source: null, dataRef: null, type: null, name: null,
    locked: false, packId: null, title: null, ...extra,
});

afterEach(cleanup);

// Every attribute value in the tile except an <img src>, plus its text.
function visibleStrings(container) {
    const out = [container.textContent];
    for (const el of container.querySelectorAll('*')) {
        for (const attr of el.attributes) {
            if (el.tagName === 'IMG' && attr.name === 'src') continue;
            out.push(attr.value);
        }
    }
    return out;
}

function expectNoPayload(container, payload) {
    const probe = payload.slice(0, 24);
    for (const text of visibleStrings(container)) expect(text).not.toContain(probe);
    expect(container.textContent).not.toMatch(/base64|data:/);
}

describe('embeddedDataLabel', () => {
    it('labels a base64 picture with its format and decoded size', () => {
        expect(SVG_BYTES.length).toBe(1200);
        expect(embeddedDataLabel(SVG_DATA_URL)).toBe('Embedded image (SVG, 1.2 KB)');
        expect(embeddedDataLabel(`data:image/png;base64,${Buffer.from('abcd').toString('base64')}`)).toBe('Embedded image (PNG, 0.1 KB)');
    });

    it('labels a percent-encoded picture and an unknown type without echoing its MIME text', () => {
        expect(embeddedDataLabel(UTF8_DATA_URL)).toMatch(/^Embedded image \(SVG, [\d.]+ KB\)$/);
        expect(embeddedDataLabel('data:application/x-evil-<b>;base64,QUJD')).toBe('Embedded file (0.1 KB)');
        expect(embeddedDataLabel('data:no-comma')).toBe('Embedded file');
    });

    it('leaves addresses alone', () => {
        expect(embeddedDataLabel('https://example.test/a.png')).toBeNull();
        expect(isDataUrl('  DATA:image/png;base64,QUJD')).toBe(true);
        expect(isDataUrl('https://example.test/data:x')).toBe(false);
    });
});

describe('PublicFileTile with an inline data: URL', () => {
    it('draws a picture data: URL at url as a thumbnail with a label heading and no link', () => {
        const [file] = tokenFileEntries({ images: [entry({ url: SVG_DATA_URL, type: 'icon', dataRef: 'action:9100101' })] });
        const { container } = render(<PublicFileTile file={file} onOpenExternal={() => {}} />);
        expect(container.querySelector('img').getAttribute('src')).toBe(SVG_DATA_URL);
        expect(container.querySelector('strong').textContent).toBe('Embedded image (SVG, 1.2 KB)');
        expect(container.querySelector('a')).toBeNull();
        expectNoPayload(container, SVG_B64);
    });

    it('shows the label in place of the URL line when only the source is a data: URL', () => {
        const [file] = tokenFileEntries({ images: [entry({ source: SVG_DATA_URL, type: 'large', name: 'Pepe Cash (large)' })] });
        const { container } = render(<PublicFileTile file={file} onOpenExternal={() => {}} />);
        expect(screen.getByText('Embedded image (SVG, 1.2 KB)')).toBeTruthy();
        expect(container.textContent).not.toContain('URL:');
        // normalizeMediaUrl does not take a data: URL, so no thumbnail or link.
        expect(container.querySelector('img, a')).toBeNull();
        expectNoPayload(container, SVG_B64);
    });

    it('never prints a percent-encoded data: URL either', () => {
        const [file] = tokenFileEntries({ images: [entry({ url: UTF8_DATA_URL, source: UTF8_DATA_URL, type: 'icon' })] });
        const { container } = render(<PublicFileTile file={file} onOpenExternal={() => {}} />);
        expect(container.textContent).toMatch(/Embedded image \(SVG, [\d.]+ KB\)/);
        expectNoPayload(container, UTF8_DATA_URL.slice(30));
    });

    it('keeps a locked data: entry without a thumbnail', () => {
        const [file] = tokenFileEntries({ images: [entry({ url: SVG_DATA_URL, locked: true, type: 'icon' })] });
        const { container } = render(<PublicFileTile file={file} onOpenExternal={() => {}} />);
        expect(container.querySelector('img, a')).toBeNull();
        expectNoPayload(container, SVG_B64);
    });
});

describe('PublicFileTile with an https URL', () => {
    it('keeps the thumbnail, open link and URL line unchanged', () => {
        const url = 'https://rarepepedirectory.com/media/pepecash-theme.png';
        const [file] = tokenFileEntries({ images: [entry({ url, source: url, name: 'theme.png' })] });
        const { container } = render(<PublicFileTile file={file} onOpenExternal={() => {}} />);
        expect(container.querySelector('img').getAttribute('src')).toBe(url);
        expect(screen.getByRole('link', { name: 'Open theme.png' }).getAttribute('href')).toBe(url);
        expect(screen.getByText(`URL: ${url}`)).toBeTruthy();
    });

    it('names an unnamed https file from its path', () => {
        const url = 'https://example.test/files/whitepaper.pdf';
        const [file] = tokenFileEntries({ files: [entry({ url, source: url })] });
        render(<PublicFileTile file={file} onOpenExternal={() => {}} />);
        expect(screen.getByRole('link', { name: 'Open whitepaper.pdf' })).toBeTruthy();
    });
});
