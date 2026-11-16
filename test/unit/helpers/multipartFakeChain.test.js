// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { createFakeMultipartChain } from '../../helpers/multipartFakeChain.js';

const RAW = {
    parts: [
        { index: 0, hex: '6d756c746970617274', digest: '8172978f4154919d2c6680671d8417514522d4ae5f9171931390a69ef68ad3fc' },
        { index: 1, hex: '2072617720766563746f72', digest: '34570c20975b553f979ce41439d435b2e5c7433b705101bf4ecbfa715cfba38d' },
    ],
    fileHash: '94d17c51c075eff21c1553f699074c8a136b2e2b87d9bd9b10dfe9d4c2fa6827',
    totalParts: 2,
    totalBytes: 20,
};

const MISMATCH = {
    parts: [
        { index: 0, hex: '6d69736d617463682d', digest: '24ecc3e729be1943456c84c004c47d5cad99202f356e0fb483b4ba7ceb49cae8' },
        { index: 1, hex: '6578706563746565', digest: '41c93e7d7565a5084f9bdfe52477c2bf51ff2ac9d1a0c7d5d56a1fdfb3eb689d' },
    ],
    fileHash: '023359fd0527dded204b9aa3dda9a5b4b2c07706ad88ce7edbf4f257323f09bb',
    totalParts: 2,
    totalBytes: 17,
};

function manifest(vector, source, txid, state = 'confirmed') {
    return {
        kind: 'manifest', source, fileHash: vector.fileHash,
        totalParts: vector.totalParts, totalBytes: vector.totalBytes, txid, state,
    };
}

function part(vector, position, source, txid, state = 'confirmed', rawData = null) {
    return {
        kind: 'part', source, fileHash: vector.fileHash, partIndex: position,
        rawData: rawData ?? Uint8Array.from(Buffer.from(vector.parts[position].hex, 'hex')),
        txid, state,
    };
}

async function actionDetail(chain, index) {
    return (await chain.sdk().getAction(index)).data[0];
}

async function capturedError(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('expected the adapter call to reject');
}

function errorBody(error) {
    return JSON.parse(new TextDecoder().decode(error.details.data));
}

describe('fake multipart chain ordering', () => {
    it('completes reverse-order and manifest-first raw vectors', async () => {
        const reverse = createFakeMultipartChain();
        const p1 = reverse.addPiece(part(RAW, 1, 'alice', 'part-1'));
        const p0 = reverse.addPiece(part(RAW, 0, 'alice', 'part-0'));
        expect((await actionDetail(reverse, p1.actionIndex)).file_part.manifest_action_index).toBeNull();
        expect((await actionDetail(reverse, p0.actionIndex)).file_part.manifest_action_index).toBeNull();
        const reverseManifest = reverse.addPiece(manifest(RAW, 'alice', 'manifest'));
        expect((await actionDetail(reverse, reverseManifest.actionIndex)).multipart).toEqual({
            file_hash: RAW.fileHash, total_parts: 2, parts_received: 2,
            total_bytes: 20, status: 'complete',
        });
        expect(await reverse.sdk().getGatedFileRaw(reverseManifest.actionIndex))
            .toEqual(Uint8Array.from(Buffer.from('multipart raw vector')));

        const first = createFakeMultipartChain();
        const firstManifest = first.addPiece(manifest(RAW, 'alice', 'manifest'));
        first.addPiece(part(RAW, 0, 'alice', 'part-0'));
        first.addPiece(part(RAW, 1, 'alice', 'part-1'));
        expect((await actionDetail(first, firstManifest.actionIndex)).multipart.status).toBe('complete');
    });
});

describe('fake multipart chain winning parts', () => {
    it('ignores duplicate, high, foreign, and mempool pieces until mining', async () => {
        const chain = createFakeMultipartChain();
        const addedManifest = chain.addPiece(manifest(RAW, 'alice', 'manifest'));
        chain.addPiece(part(RAW, 0, 'alice', 'part-0'));
        chain.addPiece(part(RAW, 0, 'alice', 'duplicate', 'confirmed', new TextEncoder().encode('wrong')));
        chain.addPiece({ ...part(RAW, 0, 'alice', 'high'), partIndex: 9 });
        chain.addPiece(part(RAW, 1, 'bob', 'foreign'));
        const waiting = chain.addPiece(part(RAW, 1, 'alice', 'waiting', 'mempool'));
        expect((await actionDetail(chain, addedManifest.actionIndex)).multipart.parts_received).toBe(1);
        expect(chain.txState(waiting.txid)).toBe('mempool');
        expect(chain.actionIndexOf(waiting.txid)).toBeNull();

        const notIndexed = await capturedError(chain.sdk().getAction(5));
        expect(notIndexed).toMatchObject({
            name: 'SDKExplorerError', code: 'EXPLORER_HTTP_404',
            details: { url: '/action/5', status: 404 },
        });
        expect(notIndexed.details.data).toEqual({
            error: 'This action has not been indexed yet.',
            code: 'ACTION_NOT_YET_INDEXED', indexed_through: '4',
        });
        chain.mine();
        expect(chain.txState(waiting.txid)).toBe('confirmed');
        expect(chain.actionIndexOf(waiting.txid)).toBe(5);
        expect((await actionDetail(chain, addedManifest.actionIndex)).multipart.status).toBe('complete');
    });
});

describe('fake multipart chain transaction states', () => {
    it('reports dropped, unknown, unseen, and action-hole states', async () => {
        const chain = createFakeMultipartChain();
        const dropped = chain.addPiece(part(RAW, 0, 'alice', 'drop-me'));
        const unknown = chain.addPiece(part(RAW, 1, 'alice', 'unknown-me'));
        chain.drop(dropped.txid);
        chain.markUnknown(unknown.txid);
        expect(chain.txState(dropped.txid)).toBe('dropped');
        expect(chain.txState(unknown.txid)).toBe('unknown');
        expect(chain.txState('never-seen')).toBeNull();
        expect(chain.actionIndexOf(dropped.txid)).toBeNull();
        expect(chain.actionIndexOf(unknown.txid)).toBeNull();
        expect(await chain.sdk().getAction(dropped.actionIndex)).toEqual({ data: [] });
        expect(await chain.sdk().getAction(unknown.actionIndex)).toEqual({ data: [] });
        expect(chain.piecesFor('alice').map((piece) => piece.txid)).toEqual(['unknown-me']);
    });
});

describe('fake multipart chain raw route', () => {
    it('returns stored bytes and exact pending, part, and mismatch refusals', async () => {
        const chain = createFakeMultipartChain();
        const addedManifest = chain.addPiece(manifest(RAW, 'alice', 'manifest'));
        const p0 = chain.addPiece(part(RAW, 0, 'alice', 'part-0'));
        const pending = await capturedError(chain.sdk().getGatedFileRaw(addedManifest.actionIndex));
        expect(pending).toMatchObject({
            name: 'SDKExplorerError', code: 'EXPLORER_HTTP_409',
            details: { url: '/file/0/raw', status: 409 },
        });
        expect(ArrayBuffer.isView(pending.details.data)).toBe(true);
        expect(pending.details.data.BYTES_PER_ELEMENT).toBe(1);
        expect(errorBody(pending)).toEqual({
            error: 'File is incomplete', code: 'FILE_INCOMPLETE',
            parts_received: 1, total_parts: 2,
        });
        const direct = await capturedError(chain.sdk().getGatedFileRaw(p0.actionIndex));
        expect(direct.code).toBe('EXPLORER_HTTP_404');
        expect(errorBody(direct)).toEqual({
            error: 'File parts cannot be served directly', code: 'FILE_PART',
        });
        chain.addPiece(part(RAW, 1, 'alice', 'part-1'));
        expect(new TextDecoder().decode(await chain.sdk().getGatedFileRaw(addedManifest.actionIndex)))
            .toBe('multipart raw vector');

        const bad = createFakeMultipartChain();
        const badManifest = bad.addPiece(manifest(MISMATCH, 'alice', 'bad-manifest'));
        bad.addPiece(part(MISMATCH, 0, 'alice', 'bad-0'));
        bad.addPiece(part(MISMATCH, 1, 'alice', 'bad-1'));
        const mismatch = await capturedError(bad.sdk().getGatedFileRaw(badManifest.actionIndex));
        expect(mismatch.code).toBe('EXPLORER_HTTP_422');
        expect(errorBody(mismatch)).toEqual({
            error: 'File assembly does not match the manifest', code: 'FILE_ASSEMBLY_MISMATCH',
        });
    });
});

describe('fake multipart chain duplicate manifests', () => {
    it('marks only the later matching manifest invalid', async () => {
        const chain = createFakeMultipartChain();
        const first = chain.addPiece(manifest(RAW, 'alice', 'manifest-1'));
        const second = chain.addPiece(manifest(RAW, 'alice', 'manifest-2'));
        const firstDetail = await actionDetail(chain, first.actionIndex);
        const secondDetail = await actionDetail(chain, second.actionIndex);
        expect(firstDetail.status).toBe('valid');
        expect(firstDetail.multipart.status).toBe('pending');
        expect(secondDetail.status).toBe('invalid: FILE_HASH (duplicate manifest)');
        expect(secondDetail).not.toHaveProperty('multipart');
    });
});

describe('fake multipart chain terminal mismatch', () => {
    it('freezes a mismatch after a later part arrives', async () => {
        const chain = createFakeMultipartChain();
        const addedManifest = chain.addPiece(manifest(MISMATCH, 'alice', 'manifest'));
        chain.addPiece(part(MISMATCH, 0, 'alice', 'part-0'));
        chain.addPiece(part(MISMATCH, 1, 'alice', 'part-1'));
        expect((await actionDetail(chain, addedManifest.actionIndex)).multipart.status).toBe('mismatch');
        chain.addPiece(part(MISMATCH, 1, 'alice', 'late-part', 'confirmed',
            new TextEncoder().encode('expected')));
        const detail = await actionDetail(chain, addedManifest.actionIndex);
        expect(detail.multipart.status).toBe('mismatch');
        expect(detail.multipart.parts_received).toBe(2);
    });
});

describe('fake multipart chain call log', () => {
    it('records every adapter call and returns copied pieces', async () => {
        const chain = createFakeMultipartChain();
        const added = chain.addPiece(manifest(RAW, 'alice', 'pending', 'mempool'));
        expect(chain.txState(added.txid)).toBe('mempool');
        expect(chain.actionIndexOf(added.txid)).toBeNull();
        const pieces = chain.piecesFor('alice');
        pieces[0].rawData = Uint8Array.of(99);
        expect(chain.piecesFor('alice')[0].rawData).toEqual(new Uint8Array());
        chain.markUnknown(added.txid);
        chain.drop(added.txid);
        chain.mine();
        await capturedError(chain.sdk().getAction(0));
        expect(chain.calls.map((call) => call.method)).toEqual([
            'addPiece', 'txState', 'actionIndexOf', 'piecesFor', 'piecesFor',
            'markUnknown', 'drop', 'mine', 'getAction',
        ]);
        expect(chain.calls[0].args).toEqual([manifest(RAW, 'alice', 'pending', 'mempool')]);
    });
});
