// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useRef, useState } from 'react';
import { useResumeFilePick } from './useResumeFilePick.js';
import { useRunningFileUpload } from './useRunningFileUpload.js';
import { useUnfinishedFileUploads } from './useUnfinishedFileUploads.js';

function matchesRunningUpload(entry, match) {
    return entry?.chainId === match?.chainId
        && entry?.sourceAddress === match?.sourceAddress
        && typeof entry?.originalSha256 === 'string'
        && typeof match?.originalSha256 === 'string'
        && entry.originalSha256.toLowerCase() === match.originalSha256.toLowerCase();
}

function visibleUploads(unfinished, uploadById, running, match) {
    if (!running || !match) return unfinished;
    return unfinished.filter(({ id }) => !matchesRunningUpload(uploadById(id), match));
}

function usePanelStart(uploadStart, refresh) {
    const [error, setError] = useState(null);
    const [runningMatch, setRunningMatch] = useState(null);
    const callsRef = useRef([]);
    const latestRef = useRef(null);
    const start = useCallback(async (request, match) => {
        setError(null);
        const token = { match };
        latestRef.current = token;
        callsRef.current.push(token);
        if (callsRef.current.length === 1) setRunningMatch(match);
        try {
            return await uploadStart(request, match);
        } catch (cause) {
            if (latestRef.current === token) setError(cause);
            throw cause;
        } finally {
            callsRef.current = callsRef.current.filter((call) => call !== token);
            setRunningMatch(callsRef.current[0]?.match ?? null);
            await refresh();
        }
    }, [refresh, uploadStart]);
    return { error, setError, runningMatch, start };
}

function usePanelPicker({
    uploadById, chainId, sourceAddress, gated, buildResumeRequest, start, setError,
}) {
    const onResume = useCallback(async (picked) => {
        let built;
        try {
            built = buildResumeRequest(picked);
        } catch (cause) {
            setError(cause);
            return;
        }
        try {
            await start(built.request, built.match);
        } catch {
            return;
        }
    }, [buildResumeRequest, setError, start]);
    return useResumeFilePick({
        uploadById, chainId, sourceAddress, gated, onResume,
    });
}

export function useMultipartUploadPanel({
    messaging,
    walletId,
    chainId,
    sourceAddress,
    gated,
    buildResumeRequest,
    pollMs,
}) {
    const list = useUnfinishedFileUploads({ messaging, walletId });
    const upload = useRunningFileUpload({ messaging, walletId, pollMs });
    const control = usePanelStart(upload.start, list.refresh);
    const picker = usePanelPicker({
        uploadById: list.uploadById, chainId, sourceAddress, gated,
        buildResumeRequest, start: control.start, setError: control.setError,
    });
    const onContinue = useCallback((id) => {
        if (!upload.running) picker.requestPick(id);
    }, [picker.requestPick, upload.running]);
    const onDiscard = useCallback((id) => {
        list.discard(id).catch(() => {});
    }, [list.discard]);

    const unfinished = useMemo(() => visibleUploads(
        list.unfinished, list.uploadById, upload.running, control.runningMatch,
    ), [list.unfinished, list.uploadById, upload.running, control.runningMatch]);
    const panelProps = {
        totalParts: upload.panel?.totalParts ?? null,
        transactions: upload.panel?.transactions ?? null,
        currentPart: upload.panel?.currentPart ?? null,
        stage: upload.panel?.stage ?? null,
        unfinished,
        onContinue,
        onDiscard,
    };
    const fileInput = {
        ref: picker.inputRef,
        onChange: picker.onInputChange,
        type: 'file',
        hidden: true,
    };
    return {
        panelProps,
        fileInput,
        start: control.start,
        running: upload.running,
        result: upload.result,
        error: control.error,
        resumeReason: picker.reason,
        listError: list.error,
    };
}
