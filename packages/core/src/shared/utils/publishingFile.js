// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { sniffContent } from './sniffContent.js';

const MIME_TYPE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Resolve and validate the FILE.TYPE value before the form reads the file.
 * Empty browser metadata stays a generic binary type, while malformed MIME
 * strings are rejected before they can break action serialization.
 *
 * @param {File | { type?: string }} file
 * @returns {{ type: string, error: string | null }}
 */
export function publishFileType(file) {
    const type = file?.type || 'application/octet-stream';
    if (!MIME_TYPE.test(type) || /[|;]/.test(type)) {
        return {
            type,
            error: `That file reports an invalid content type (${type || 'empty'}). Choose a file with a standard type such as image/png or text/plain.`,
        };
    }
    return { type, error: null };
}

/**
 * Build a script-inert image preview from sniffed bytes. The declared MIME
 * type is not trusted because local files can carry incorrect metadata.
 *
 * @param {Uint8Array | null | undefined} bytes
 * @returns {string | null}
 */
export function imagePreviewDataUrl(bytes) {
    if (!(bytes instanceof Uint8Array)) return null;
    const sniffed = sniffContent(bytes);
    if (sniffed.kind !== 'image' && sniffed.kind !== 'svg') return null;
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    try {
        return `data:${sniffed.mime};base64,${btoa(binary)}`;
    } catch {
        return null;
    }
}
