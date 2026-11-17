// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A gated (locked) TIS entry is ciphertext on chain: the token page must keep it
// visible as locked and must never hand its bytes to an img, audio or video
// element or a download link. The Files tab builds its rows with
// tokenFileEntries and draws each one with PublicFileTile.

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PublicFileTile, tokenFileEntries } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';

const locked = (extra = {}) => ({
    url: null, dataRef: 'action:7', type: null, name: null,
    locked: true, packId: 'p1', title: null, ...extra,
});
const open = (url, extra = {}) => ({
    url, dataRef: null, type: null, name: null,
    locked: false, packId: null, title: null, ...extra,
});

afterEach(cleanup);

describe('tokenFileEntries gated entries', () => {
    it('keeps locked entries of every kind without a URL', () => {
        const entries = tokenFileEntries({
            images: [locked({ name: 'Token-gated media', dataRef: 'action:7' })],
            audio: [locked({ name: 'Secret track', dataRef: 'action:8' })],
            video: [locked({ title: 'Teaser', dataRef: 'action:9' })],
            files: [locked({ name: 'bonus.zip', dataRef: 'action:10' })],
        });
        expect(entries.map((e) => e.kind).sort()).toEqual(['audio', 'file', 'image', 'video']);
        expect(entries.every((e) => e.locked && !e.url)).toBe(true);
    });
});

describe('PublicFileTile gated entries', () => {
    it.each([
        ['image', locked({ name: 'Token-gated media' })],
        ['audio', locked({ name: 'Secret track' })],
        ['video', locked({ title: 'Teaser' })],
        ['file', locked({ name: 'bonus.zip' })],
    ])('draws a locked %s entry with no media element and no link', (kind, entry) => {
        const [file] = tokenFileEntries({ [kind === 'image' ? 'images' : kind === 'file' ? 'files' : kind]: [entry] });
        const { container } = render(<PublicFileTile file={file} onOpenExternal={() => {}} />);
        expect(container.querySelector('img, audio, video, a')).toBeNull();
        expect(container.textContent).toContain('Locked: Yes');
    });

    it('still opens an unlocked image with its preview', () => {
        const [file] = tokenFileEntries({ images: [open('https://example.test/a.png', { name: 'a.png' })] });
        const { container } = render(<PublicFileTile file={file} onOpenExternal={() => {}} />);
        expect(container.querySelector('img').getAttribute('src')).toBe('https://example.test/a.png');
        expect(screen.getByRole('link', { name: 'Open a.png' })).toBeTruthy();
    });
});
