// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import {
    FILE_PIECE_TXID_CONFLICT,
    FILE_RECORD_SAVE_FAILED,
    recordPieceBeforeBroadcast,
    recoveryRecordFor,
} from '../../../packages/core/src/flows/filePieceRecovery.js';

const COMMIT_HEX = '0200000001';
const COMMIT_TXID = '11'.repeat(32);
const REVEAL_TXID = '22'.repeat(32);

function fixture(indices = [0, 1, -1]) {
    return {
        id: 'upload-1',
        stage: 'sending',
        pieces: indices.map((index) => ({ index, signedTxids: [], txid: null, actionIndex: null })),
    };
}

describe('envelope recovery records', () => {
    it('stores the commit txid before the reveal txid', () => {
        expect(recoveryRecordFor({
            lane: 'envelope',
            signedCommitHex: COMMIT_HEX,
            commitTxid: COMMIT_TXID,
            revealPlan: { txid: REVEAL_TXID },
        })).toEqual([COMMIT_TXID, REVEAL_TXID]);
    });
});

describe('standard recovery records', () => {
    it('stores the signed commit hex, commit txid, and reveal txid in broadcast order', () => {
        expect(recoveryRecordFor({
            lane: 'standard',
            signedCommitHex: COMMIT_HEX,
            commitTxid: COMMIT_TXID,
            revealPlan: { txid: REVEAL_TXID },
        })).toEqual([COMMIT_HEX, COMMIT_TXID, REVEAL_TXID]);
    });
});

describe('piece persistence before broadcast', () => {
    it('does not resolve or mutate the input while save is pending', async () => {
        const record = fixture();
        let releaseSave;
        const save = vi.fn(() => new Promise((resolve) => { releaseSave = resolve; }));
        let returned = false;
        const writing = recordPieceBeforeBroadcast({
            record, index: 1, lane: 'envelope', signedTxids: [COMMIT_TXID, REVEAL_TXID], save,
        }).then((value) => { returned = true; return value; });

        await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
        expect(returned).toBe(false);
        expect(record.pieces[1].signedTxids).toEqual([]);
        releaseSave();
        const saved = await writing;
        expect(saved.pieces[1].signedTxids).toEqual([COMMIT_TXID, REVEAL_TXID]);
        expect(saved).not.toBe(record);
    });

    it('turns a save rejection into a typed failure', async () => {
        const cause = new Error('disk unavailable');
        const writing = recordPieceBeforeBroadcast({
            record: fixture(), index: 0, lane: 'standard',
            signedTxids: [COMMIT_HEX, COMMIT_TXID, REVEAL_TXID],
            save: vi.fn(async () => { throw cause; }),
        });
        await expect(writing).rejects.toMatchObject({ code: FILE_RECORD_SAVE_FAILED, cause });
    });
});

describe('idempotent piece persistence', () => {
    it('accepts the same signed transaction data and saves a new record', async () => {
        const record = fixture();
        record.pieces[0].signedTxids = [COMMIT_TXID, REVEAL_TXID];
        const save = vi.fn(async () => {});
        const saved = await recordPieceBeforeBroadcast({
            record, index: 0, lane: 'envelope', signedTxids: [COMMIT_TXID, REVEAL_TXID], save,
        });
        expect(save).toHaveBeenCalledWith(saved);
        expect(saved).not.toBe(record);
        expect(saved.pieces[0]).not.toBe(record.pieces[0]);
    });
});

describe('piece recovery conflicts', () => {
    it('refuses different data once a piece has signed transaction data', async () => {
        const record = fixture();
        record.pieces[0].signedTxids = [COMMIT_TXID, REVEAL_TXID];
        const save = vi.fn(async () => {});
        const writing = recordPieceBeforeBroadcast({
            record, index: 0, lane: 'envelope', signedTxids: [COMMIT_TXID, '33'.repeat(32)], save,
        });
        await expect(writing).rejects.toMatchObject({ code: FILE_PIECE_TXID_CONFLICT });
        expect(save).not.toHaveBeenCalled();
    });
});

describe('manifest recovery', () => {
    it('persists the manifest identified by index -1', async () => {
        const save = vi.fn(async () => {});
        const saved = await recordPieceBeforeBroadcast({
            record: fixture(), index: -1, lane: 'standard',
            signedTxids: [COMMIT_HEX, COMMIT_TXID, REVEAL_TXID], save,
        });
        expect(saved.pieces.find((piece) => piece.index === -1)?.signedTxids)
            .toEqual([COMMIT_HEX, COMMIT_TXID, REVEAL_TXID]);
        expect(save).toHaveBeenCalledOnce();
    });
});
