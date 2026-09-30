// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { getActionFormats } from './sdkIntrospection.js';

const UNSUPPORTED = Object.freeze({ share: false, transfer: false, union: false });

/**
 * @param {{ sdkRegistry: any, chainId: string }} params
 * @returns {Promise<{ share: boolean, transfer: boolean, union: boolean }>}
 */
export async function listFormatSupport({ sdkRegistry, chainId }) {
    try {
        const formats = await getActionFormats({ sdkRegistry, chainId, action: 'LIST' });
        const supported = formats !== null
            && typeof formats === 'object'
            && Object.hasOwn(formats, '2')
            && Object.hasOwn(formats, '3');
        return supported
            ? { share: true, transfer: true, union: true }
            : { ...UNSUPPORTED };
    } catch {
        return { ...UNSUPPORTED };
    }
}
