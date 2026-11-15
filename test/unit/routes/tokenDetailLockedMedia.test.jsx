// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MediaSubpanel, tokenMediaBuckets } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';

const packs = { p1: { name: 'Bonus pack', description: 'extras' } };
const locked = (extra = {}) => ({
    url: null, dataRef: 'action:7', type: null, name: null,
    locked: true, packId: 'p1', title: null, ...extra,
});
const open = (url, extra = {}) => ({
    url, dataRef: null, type: null, name: null,
    locked: false, packId: null, title: null, ...extra,
});

afterEach(cleanup);

describe('MediaSubpanel gated entries', () => {
    it('renders a lock card instead of an audio element for a locked audio entry', () => {
        const { container } = render(
            <MediaSubpanel kind="audio" images={[]} audio={[locked({ name: 'Secret track' })]} video={[]} files={[]} packs={packs} />,
        );
        expect(container.querySelector('audio')).toBeNull();
        expect(screen.getByRole('group', { name: 'Locked: Secret track' })).toBeTruthy();
        expect(screen.getByText('Bonus pack')).toBeTruthy();
    });

    it('renders a lock card instead of a video element for a locked video entry', () => {
        const { container } = render(
            <MediaSubpanel kind="video" images={[]} audio={[]} video={[locked({ title: 'Teaser' })]} files={[]} packs={packs} />,
        );
        expect(container.querySelector('video')).toBeNull();
        expect(screen.getByRole('group', { name: 'Locked: Teaser' })).toBeTruthy();
    });

    it('renders a lock card instead of an img for a locked image entry and keeps unlocked images', () => {
        const { container } = render(
            <MediaSubpanel
                kind="image"
                images={[locked(), open('https://example.test/a.png')]}
                audio={[]}
                video={[]}
                files={[]}
                packs={packs}
            />,
        );
        expect(container.querySelectorAll('img')).toHaveLength(1);
        expect(container.querySelector('img').getAttribute('src')).toBe('https://example.test/a.png');
        expect(screen.getByRole('group', { name: 'Locked: Token-gated media' })).toBeTruthy();
    });

    it('shows a locked file as a lock card with no download link', () => {
        const { container } = render(
            <MediaSubpanel kind="files" images={[]} audio={[]} video={[]} files={[locked({ name: 'bonus.zip' })]} packs={packs} />,
        );
        expect(container.querySelector('a')).toBeNull();
        expect(screen.getByRole('group', { name: 'Locked: bonus.zip' })).toBeTruthy();
    });

    it('renders unlocked audio exactly as before', () => {
        const { container } = render(
            <MediaSubpanel kind="audio" images={[]} audio={[open('https://example.test/a.mp3')]} video={[]} files={[]} packs={packs} />,
        );
        expect(container.querySelector('audio').getAttribute('src')).toBe('https://example.test/a.mp3');
        expect(screen.queryByRole('group')).toBeNull();
    });
});

describe('tokenMediaBuckets gated entries', () => {
    it('keeps locked entries without a URL and drops unlocked entries without one', () => {
        const info = {
            images: [locked({ type: 'large' }), open(null, { type: 'large' })],
            audio: [locked(), open(null)],
            video: [locked()],
            files: [locked(), open('http://[bad')],
        };
        const out = tokenMediaBuckets(info);
        expect(out.images).toHaveLength(1);
        expect(out.audio).toHaveLength(1);
        expect(out.video).toHaveLength(1);
        expect(out.files).toHaveLength(1);
        expect([...out.images, ...out.audio, ...out.video, ...out.files].every((e) => e.locked)).toBe(true);
    });
});
