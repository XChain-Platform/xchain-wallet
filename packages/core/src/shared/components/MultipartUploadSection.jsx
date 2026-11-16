// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { MultipartUploadPanel } from './MultipartUploadPanel.jsx';
import { StatusMessage } from '../../ui/StatusMessage.jsx';
import { multipartFailureMessage } from '../utils/multipartFailureMessage.js';
import { resumePickMessage } from '../utils/resumePickMessage.js';

function statusText({ resumeReason, error, listError, fallbackMessage }) {
    const resumeMessage = resumePickMessage(resumeReason);
    if (resumeMessage) return resumeMessage.message;
    const failureMessage = multipartFailureMessage(error);
    if (failureMessage) return failureMessage.message;
    if ((error || listError) && fallbackMessage) return fallbackMessage;
    return null;
}

export function MultipartUploadSection({
    panelProps,
    fileInput,
    resumeReason,
    error,
    listError,
    fallbackMessage,
}) {
    const message = statusText({ resumeReason, error, listError, fallbackMessage });
    return (
        <>
            {fileInput ? (
                <input type="file" hidden ref={fileInput.ref} onChange={fileInput.onChange} />
            ) : null}
            {message ? <StatusMessage variant="error">{message}</StatusMessage> : null}
            {panelProps && typeof panelProps === 'object' ? (
                <MultipartUploadPanel {...panelProps} />
            ) : null}
        </>
    );
}
