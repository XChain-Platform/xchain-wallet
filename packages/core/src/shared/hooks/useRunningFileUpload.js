// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useRef, useState } from 'react';
import { findActiveUpload, summaryPanelProps } from '../../flows/multipartPanelProps.js';

function hookError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function activeSession(session, sessionRef, mountedRef) {
    return mountedRef.current && session.active && sessionRef.current === session;
}

function schedulePoll(session, sessionRef, mountedRef, setPanel) {
    session.timer = setTimeout(async () => {
        session.timer = null;
        try {
            const reply = await session.messaging.listPendingFileUploads({ walletId: session.walletId });
            if (!activeSession(session, sessionRef, mountedRef)) return;
            const entry = findActiveUpload(Array.isArray(reply?.uploads) ? reply.uploads : [], session.match);
            if (entry) setPanel(summaryPanelProps(entry));
        } catch {
            return;
        } finally {
            if (activeSession(session, sessionRef, mountedRef)) {
                schedulePoll(session, sessionRef, mountedRef, setPanel);
            }
        }
    }, session.pollMs);
}

function validateHook(messaging, walletId) {
    if (typeof walletId !== 'string' || walletId.trim().length === 0) {
        throw hookError('FILE_UPLOAD_HOOK_INVALID', 'Running file upload requires a walletId');
    }
    if (typeof messaging?.fileMultipart !== 'function') {
        throw hookError('FILE_UPLOAD_HOOK_INVALID', 'Running file upload requires fileMultipart');
    }
    if (typeof messaging.listPendingFileUploads !== 'function') {
        throw hookError('FILE_UPLOAD_HOOK_INVALID', 'Running file upload requires listPendingFileUploads');
    }
}

export function useRunningFileUpload({ messaging, walletId, pollMs = 2000 }) {
    const [running, setRunning] = useState(false);
    const [panel, setPanel] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const sessionRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => () => {
        mountedRef.current = false;
        const session = sessionRef.current;
        if (session) {
            session.active = false;
            clearTimeout(session.timer);
        }
        sessionRef.current = null;
    }, []);

    const start = useCallback(async (request, match) => {
        findActiveUpload([], match);
        validateHook(messaging, walletId);
        if (sessionRef.current) {
            throw hookError('FILE_UPLOAD_ALREADY_RUNNING', 'A file upload is already running');
        }
        const session = { active: true, match, messaging, pollMs, timer: null, walletId };
        sessionRef.current = session;
        setRunning(true);
        setPanel(null);
        setResult(null);
        setError(null);
        schedulePoll(session, sessionRef, mountedRef, setPanel);
        try {
            const reply = await messaging.fileMultipart(request);
            if (activeSession(session, sessionRef, mountedRef)) setResult(reply);
            return reply;
        } catch (cause) {
            if (activeSession(session, sessionRef, mountedRef)) setError(cause);
            throw cause;
        } finally {
            if (activeSession(session, sessionRef, mountedRef)) {
                session.active = false;
                clearTimeout(session.timer);
                sessionRef.current = null;
                setRunning(false);
                setPanel(null);
            }
        }
    }, [messaging, pollMs, walletId]);

    return { start, running, panel, result, error };
}
