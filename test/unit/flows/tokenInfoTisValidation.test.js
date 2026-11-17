// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
    MAX_TIS_DOCUMENT_BYTES,
    descriptionJsonUrl,
    fetchTisBundle,
    tokenInfoFor,
    validateTisDocument,
} from '../../../packages/core/src/flows/tokenInfo.js';

const DOCUMENT = {
    tick: 'MYTOKEN',
    name: '<b>Token Name</b>',
    description: '<script>literal markup</script>',
    website: 'https://project.example/',
    owner: { name: 'Owner', title: 'CTO', organization: 'Example Org' },
    contacts: [{ type: 'email', data: 'owner@example.test' }],
    categories: [{ type: 'main', data: 'Art' }],
    social: [{ type: 'github', data: 'https://github.com/example' }],
    images: [{ type: 'icon', data_ref: 'action:10', name: 'Icon' }],
    audio: [{ type: 'mp3', data: 'https://cdn.example/audio.mp3' }],
    video: [{ type: 'mp4', data: 'https://cdn.example/video.mp4' }],
    files: [{ type: 'pdf', data_ref: 'action:11', title: 'Paper', locked: true, pack_id: 'deluxe' }],
    packs: { deluxe: { name: 'Deluxe', description: 'Extra files' } },
    dns: [{ type: 'MX', host: '@', value: 'mail.example', priority: 10 }],
    html: '<iframe src="https://hostile.example"></iframe>',
};

function response(body) {
    return { ok: true, headers: { get: () => null }, text: async () => body };
}

describe('Token Information Standard fetch validation', () => {
    it('fetches and validates a v1.1.2 document while preserving markup as text', async () => {
        const text = JSON.stringify(DOCUMENT);
        const fetch = vi.fn().mockResolvedValue(response(text));
        const bundle = await fetchTisBundle({ description: 'https://issuer.example/token.json', fetch });

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(bundle).toMatchObject({
            name: '<b>Token Name</b>',
            description: '<script>literal markup</script>',
            htmlAvailable: true,
        });
        expect(bundle.html).toBeUndefined();
        expect(bundle.files[0]).toMatchObject({ dataRef: 'action:11', locked: true, packId: 'deluxe' });
    });

    it('enforces a declared SHA-256 and rejects a mismatch', async () => {
        const text = JSON.stringify(DOCUMENT);
        const hash = createHash('sha256').update(text).digest('hex');
        const fetch = vi.fn().mockResolvedValue(response(text));
        await expect(fetchTisBundle({ description: `https://issuer.example/token.json;${hash}`, fetch }))
            .resolves.toMatchObject({ name: '<b>Token Name</b>' });
        await expect(fetchTisBundle({ description: `https://issuer.example/token.json;${'0'.repeat(64)}`, fetch }))
            .resolves.toBeNull();
    });

    it('rejects an oversized document before parsing', async () => {
        const body = ' '.repeat(MAX_TIS_DOCUMENT_BYTES + 1);
        await expect(fetchTisBundle({
            description: 'https://issuer.example/token.json',
            fetch: vi.fn().mockResolvedValue(response(body)),
        })).resolves.toBeNull();
    });

    it('supports v1.0 data entries and enforces the corrected DNS requirements', () => {
        expect(validateTisDocument({
            tick: 'OLD',
            name: 'Old token',
            images: [{ type: 'icon', data: 'https://example.test/icon.png', locked: 'legacy-extra' }],
        })).toBe(true);
        expect(validateTisDocument({
            tick: 'BAD', name: 'Bad DNS', dns: [{ type: 'MX', host: '@', value: 'mail.example' }],
        })).toBe(false);
        expect(validateTisDocument({ tick: 'BAD' })).toBe(false);
    });

    it('recognizes supported content schemes and refuses HTTP', () => {
        expect(descriptionJsonUrl('ipfs:QmExample')).toBe('https://ipfs.io/ipfs/QmExample');
        expect(descriptionJsonUrl('ar:transaction')).toBe('https://arweave.net/transaction');
        expect(descriptionJsonUrl(`ord:${'a'.repeat(64)}`)).toContain('type=json&tx=');
        expect(descriptionJsonUrl('http://issuer.example/token.json')).toBeNull();
    });

    it('loads ord documents only through the configured explorer relay', async () => {
        const fetch = vi.fn().mockResolvedValue(response(JSON.stringify(DOCUMENT)));
        const sdk = { fileRawUrl: () => 'https://explorer.example/RBTC/api/file/0/raw' };
        await expect(fetchTisBundle({
            description: `ord:${'a'.repeat(64)}`,
            fetch,
            sdk,
        })).resolves.toMatchObject({ name: '<b>Token Name</b>' });

        const requested = new URL(fetch.mock.calls[0][0]);
        expect(requested.origin).toBe('https://explorer.example');
        expect(requested.pathname).toBe('/RBTC/relay');
        expect(requested.searchParams.get('url')).toContain('type=json&tx=');
    });

    it('marks a recognized invalid document for the quiet renderer note', async () => {
        const info = await tokenInfoFor({
            sdkRegistry: { get: () => ({ getToken: async () => ({ info: { description: 'https://issuer.example/token.json' } }) }) },
            chainId: 'bitcoin-regtest',
            tick: 'BAD',
            fetch: vi.fn().mockResolvedValue(response('{"name":"missing tick"}')),
        });
        expect(info.tisReadError).toBe(true);
        expect(info.description).toBeNull();
    });
});
