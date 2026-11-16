// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { checkResumePick } from '../../flows/multipartResumePick.js';

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
        const reader = new FileReader();
        const current = () => mountedRef.current && readId === readRef.current;
        reader.onerror = () => { if (current()) setReason('read_failed'); };
        reader.onload = () => {
            if (!current()) return;
            if (!(reader.result instanceof ArrayBuffer)) { setReason('read_failed'); return; }
            const bytes = new Uint8Array(reader.result);
            const entry = uploadById(requestedId);
            if (!entry) { setReason('not_resumable'); return; }
            if (bytes.length === 0) { setReason('file_mismatch'); return; }
            let outcome;
            try {
                outcome = checkResumePick({ entry, bytes, chainId, sourceAddress, gated });
            } catch (error) {
                if (error?.code !== 'FILE_RESUME_PICK_INVALID') throw error;
                setReason('not_resumable');
                return;
            }
            if (!outcome.ok) { setReason(outcome.reason); return; }
            readRef.current += 1;
            pendingRef.current = null;
            setPendingId(null);
            setReason(null);
            onResume({ entry, bytes, resumeId: outcome.resumeId });
        };
        reader.readAsArrayBuffer(file);
    }, [chainId, gated, onResume, sourceAddress, uploadById]);

    return { inputRef, onInputChange, requestPick, pendingId, reason, clear };
}
