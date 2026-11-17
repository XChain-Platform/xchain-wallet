// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { fileRefFor } from '../../flows/fileMultipartRequest.js';
import { checkResumePickMeta } from '../../flows/multipartResumePick.js';

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
        const finish = (fileRef) => {
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
                    originalSha256: entry.originalSha256,
                },
                resumeId: entry.id,
            });
        };
        const extension = globalThis.chrome?.runtime?.id
            && typeof globalThis.chrome.runtime.sendMessage === 'function';
        if (!extension) {
            finish({ kind: 'inline', blob: file });
            return;
        }
        fileRefFor(file, { key: entry.id }).then(finish, () => {
            if (current()) setReason('read_failed');
        });
    }, [chainId, gated, onResume, sourceAddress, uploadById]);

    return { inputRef, onInputChange, requestPick, pendingId, reason, clear };
}
