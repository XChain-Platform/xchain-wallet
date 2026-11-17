// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { fileRefFor } from '../../flows/fileMultipartRequest.js';
import {
    checkResumePickDigest,
    checkResumePickMeta,
} from '../../flows/multipartResumePick.js';

const DIGEST_CHUNK_BYTES = 4 * 1024 * 1024;

function readSlice(file, start, end) {
    const slice = file.slice(start, end);
    if (typeof slice?.arrayBuffer === 'function') return slice.arrayBuffer();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
        reader.onload = () => resolve(reader.result);
        reader.readAsArrayBuffer(slice);
    });
}

export async function digestPickedFile(file) {
    const hasher = sha256.create();
    for (let start = 0; start < file.size; start += DIGEST_CHUNK_BYTES) {
        const end = Math.min(start + DIGEST_CHUNK_BYTES, file.size);
        const bytes = new Uint8Array(await readSlice(file, start, end));
        if (bytes.length !== end - start) throw new Error('File slice length changed');
        hasher.update(bytes);
    }
    return bytesToHex(hasher.digest());
}

function useReadGuard() {
    const readRef = useRef(0);
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            readRef.current += 1;
        };
    }, []);
    return { readRef, mountedRef };
}

export function useResumeFilePick({ uploadById, chainId, sourceAddress, gated, onResume }) {
    const inputRef = useRef(null);
    const pendingRef = useRef(null);
    const { readRef, mountedRef } = useReadGuard();
    const [pendingId, setPendingId] = useState(null);
    const [reason, setReason] = useState(null);

    const requestPick = useCallback((id) => {
        readRef.current += 1;
        pendingRef.current = id;
        setPendingId(id);
        setReason(null);
        inputRef.current?.click();
    }, []);

    const clear = useCallback(() => {
        readRef.current += 1;
        pendingRef.current = null;
        setPendingId(null);
        setReason(null);
    }, []);

    const onInputChange = useCallback((event) => {
        const target = event?.target;
        const file = target?.files?.[0];
        if (target) target.value = '';
        const requestedId = pendingRef.current;
        if (!requestedId || !file) return;
        const readId = ++readRef.current;
        const current = () => mountedRef.current && readId === readRef.current;
        const entry = uploadById(requestedId);
        if (!entry) { setReason('not_resumable'); return; }
        if (!Number.isSafeInteger(file.size) || file.size <= 0) {
            setReason('file_mismatch');
            return;
        }
        let outcome;
        try {
            outcome = checkResumePickMeta({ entry, chainId, sourceAddress, gated });
        } catch (error) {
            if (error?.code !== 'FILE_RESUME_PICK_INVALID') throw error;
            setReason('not_resumable');
            return;
        }
        if (!outcome.ok) { setReason(outcome.reason); return; }
        const finish = (fileRef, originalSha256) => {
            if (!current()) return;
            readRef.current += 1;
            pendingRef.current = null;
            setPendingId(null);
            setReason(null);
            onResume({
                entry,
                bytes: {
                    byteLength: Math.max(file.size, 390_001),
                    file,
                    fileRef,
                    originalSha256,
                },
                resumeId: entry.id,
            });
        };
        digestPickedFile(file).then(async (originalSha256) => {
            if (!current()) return;
            let digestOutcome;
            try {
                digestOutcome = checkResumePickDigest(entry, originalSha256);
            } catch (error) {
                if (error?.code !== 'FILE_RESUME_PICK_INVALID') throw error;
                setReason('not_resumable');
                return;
            }
            if (!digestOutcome.ok) {
                setReason(digestOutcome.reason);
                return;
            }
            const fileRef = await fileRefFor(file, { key: entry.id });
            finish(fileRef, originalSha256);
        }).catch(() => {
            if (current()) setReason('read_failed');
        });
    }, [chainId, gated, onResume, sourceAddress, uploadById]);

    return { inputRef, onInputChange, requestPick, pendingId, reason, clear };
}
