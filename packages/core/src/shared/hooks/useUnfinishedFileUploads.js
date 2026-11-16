// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const UNFINISHED_STAGES = new Set(['funding', 'sending', 'assembling']);
const TRACKED_STAGES = new Set([...UNFINISHED_STAGES, 'mismatch']);

function panelUpload(upload) {
    const { id, name, partsSent, totalParts, paidTransactions } = upload;
    return { id, name, partsSent, totalParts, paidTransactions };
}

function errorMessage(reason) {
    return reason instanceof Error ? reason.message : String(reason);
}

function bucketUploads(uploads) {
    return {
        unfinished: uploads.filter((upload) => UNFINISHED_STAGES.has(upload?.stage)).map(panelUpload),
        failed: uploads.filter((upload) => upload?.stage === 'mismatch').map(panelUpload),
    };
}

function trackedUploads(response) {
    if (!Array.isArray(response?.uploads)) return [];
    return response.uploads.filter((upload) => TRACKED_STAGES.has(upload?.stage));
}

function useDiscardUpload({ messaging, walletId, contextRef, setUploads, setError }) {
    return useCallback(async (id) => {
        setError(null);
        const discardMessaging = messaging;
        const discardWalletId = walletId;
        try {
            const response = await discardMessaging.discardPendingFileUpload({
                walletId: discardWalletId,
                id,
            });
            const current = contextRef.current;
            if (current.messaging === discardMessaging && current.walletId === discardWalletId) {
                setUploads((currentUploads) => currentUploads.filter((upload) => upload?.id !== id));
            }
            return response?.paidTransactions;
        } catch (cause) {
            const current = contextRef.current;
            if (current.messaging === discardMessaging && current.walletId === discardWalletId) {
                setError(errorMessage(cause));
            }
            throw cause;
        }
    }, [contextRef, messaging, setError, setUploads, walletId]);
}

export function useUnfinishedFileUploads({ messaging, walletId }) {
    const [uploads, setUploads] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const requestRef = useRef(0);
    const contextRef = useRef({ messaging, walletId });
    contextRef.current = { messaging, walletId };

    const refresh = useCallback(async () => {
        const request = ++requestRef.current;
        setError(null);
        if (!walletId || typeof messaging?.listPendingFileUploads !== 'function') {
            setUploads([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const reply = await messaging.listPendingFileUploads({ walletId });
            if (request !== requestRef.current) return;
            setUploads(trackedUploads(reply));
        } catch (reason) {
            if (request !== requestRef.current) return;
            setUploads([]);
            setError(errorMessage(reason));
        } finally {
            if (request === requestRef.current) setLoading(false);
        }
    }, [messaging, walletId]);

    useEffect(() => {
        refresh();
        return () => { requestRef.current += 1; };
    }, [refresh]);

    const discard = useDiscardUpload({ messaging, walletId, contextRef, setUploads, setError });
    const { unfinished, failed } = useMemo(() => bucketUploads(uploads), [uploads]);
    const uploadById = useCallback(
        (id) => uploads.find((upload) => upload?.id === id) ?? null,
        [uploads],
    );
    return { unfinished, failed, loading, error, refresh, discard, uploadById };
}
