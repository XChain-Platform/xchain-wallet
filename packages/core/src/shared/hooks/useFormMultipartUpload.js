// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo } from 'react';
import { fileUploadStart } from '../../flows/fileUploadStart.js';
import { chooseFileUploadPath } from '../../flows/fileUploadPath.js';
import { multipartResumeRequestBuilder } from '../../flows/multipartResumeRequest.js';
import { useMultipartUploadPanel } from './useMultipartUploadPanel.js';

function uploadMaxBytes(singleTransactionCap, support) {
    try {
        return chooseFileUploadPath({
            byteLength: 1,
            singleTransactionCap,
            support,
        }).maxBytes;
    } catch {
        return null;
    }
}

export function useFormMultipartUpload({
    messaging, walletId, chainId, from, singleTransactionCap,
    support, gate = null, rate, pollMs,
}) {
    const maxBytes = useMemo(
        () => uploadMaxBytes(singleTransactionCap, support),
        [singleTransactionCap, support],
    );
    const buildResumeRequest = useMemo(() => multipartResumeRequestBuilder({
        walletId, chainId, from, singleTransactionCap, support, gate, rate,
    }), [walletId, chainId, from, singleTransactionCap, support, gate, rate]);
    const panel = useMultipartUploadPanel({
        messaging,
        walletId,
        chainId,
        sourceAddress: from.address,
        gated: gate !== null,
        buildResumeRequest,
        pollMs,
    });
    const startFile = useCallback(async ({
        bytes, meta, linkTarget = null, existingKeyHash,
    }) => {
        const optionalKeyHash = existingKeyHash === undefined ? {} : { existingKeyHash };
        const planned = fileUploadStart({
            walletId, chainId, from, bytes, meta, singleTransactionCap,
            support, linkTarget, gate, rate, ...optionalKeyHash,
        });
        if (planned.path === 'single') return { path: 'single', maxBytes: planned.maxBytes };
        if (planned.path === 'refused') {
            return { path: 'refused', reason: planned.reason, maxBytes: planned.maxBytes };
        }
        const reply = await panel.start(planned.request, planned.match);
        return { path: 'multipart', reply };
    }, [walletId, chainId, from, singleTransactionCap, support, gate, rate, panel.start]);
    const { panelProps, fileInput, resumeReason, error, listError } = panel;
    return {
        maxBytes,
        startFile,
        sectionProps: { panelProps, fileInput, resumeReason, error, listError },
        running: panel.running,
        result: panel.result,
    };
}
