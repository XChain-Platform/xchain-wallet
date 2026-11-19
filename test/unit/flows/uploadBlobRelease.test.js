// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    releaseUploadBlob,
    releasesUploadBlob,
    UPLOAD_BLOB_RELEASE_STAGES,
} from '../../../packages/core/src/flows/uploadBlobRelease.js';
import { PENDING_FILE_UPLOAD_STAGES } from '../../../packages/core/src/schemas/pendingFileUpload.js';

describe('upload blob release stages', () => {
    it('releases complete and mismatch but no other pending upload stage', () => {
        expect(Object.isFrozen(UPLOAD_BLOB_RELEASE_STAGES)).toBe(true);
        expect(UPLOAD_BLOB_RELEASE_STAGES).toEqual(['complete', 'mismatch']);
        expect(UPLOAD_BLOB_RELEASE_STAGES.every(
            (stage) => PENDING_FILE_UPLOAD_STAGES.includes(stage),
        )).toBe(true);
        for (const stage of PENDING_FILE_UPLOAD_STAGES) {
            expect(releasesUploadBlob(stage)).toBe(UPLOAD_BLOB_RELEASE_STAGES.includes(stage));
        }
    });
});

describe('upload blob release', () => {
    it('removes the blob once and reports release', async () => {
        const remove = vi.fn(async () => undefined);

        await expect(releaseUploadBlob({ remove }, 'upload-1')).resolves.toBe(true);

        expect(remove).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledWith('upload-1');
    });

    it.each([
        ['a missing store', undefined],
        ['a store without remove', {}],
    ])('returns false for %s', async (_label, fileBlobs) => {
        await expect(releaseUploadBlob(fileBlobs, 'upload-1')).resolves.toBe(false);
    });

    it('propagates a remove rejection unchanged', async () => {
        const failure = new Error('remove failed');
        const remove = vi.fn(async () => { throw failure; });

        await expect(releaseUploadBlob({ remove }, 'upload-1')).rejects.toBe(failure);
        expect(remove).toHaveBeenCalledOnce();
    });

    it.each(['', 42])('rejects invalid id %#', async (id) => {
        await expect(releaseUploadBlob(undefined, id)).rejects.toMatchObject({
            code: 'UPLOAD_BLOB_RELEASE_INVALID',
        });
    });
});
