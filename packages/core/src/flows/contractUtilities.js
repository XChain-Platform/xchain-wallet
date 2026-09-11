// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// contractUtilities: pure-function wrappers over sdk.contracts.* for
// the DEPLOY form's validate / estimate-size / suggest-gas buttons.
// These reach through an sdkRegistry-scoped SDK so the contract
// authoring tools (acorn-based syntax check, UTF-8 byte counting,
// heuristic gas estimation) are versioned alongside the decoder.
//
// None of these make network calls. Acorn is bundled with the SDK.
// They're routed through the messaging layer anyway for consistency
// (the UI never imports an SDK directly; it always goes through the
// vault-owning process for discipline even when no secret is in play).

import { readExportedMeta } from './contractMetaPreflight.js';

/**
 * Validate contract source: size check + acorn parse + float-literal
 * warnings + reserved-identifier check.
 *
 * @param {{ sdkRegistry: any, chainId: string, code: string }} params
 * @returns {Promise<{ valid: boolean, error?: string, warnings?: string[] }>}
 */
export async function contractValidate({ sdkRegistry, chainId, code }) {
    if (!sdkRegistry) throw new Error('contractValidate: sdkRegistry is required');
    if (!chainId) throw new Error('contractValidate: chainId is required');
    if (typeof code !== 'string') throw new Error('contractValidate: code is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.contracts.validate(code);
}

/**
 * @param {{ sdkRegistry: any, chainId: string, code: string }} params
 * @returns {Promise<{ bytes: number, withinLimit: boolean }>}
 */
export async function contractCheckCodeSize({ sdkRegistry, chainId, code }) {
    if (!sdkRegistry) throw new Error('contractCheckCodeSize: sdkRegistry is required');
    if (!chainId) throw new Error('contractCheckCodeSize: chainId is required');
    if (typeof code !== 'string') throw new Error('contractCheckCodeSize: code is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.contracts.checkCodeSize(code);
}

/**
 * Heuristic gas suggestion for a DEPLOY. The SDK's implementation
 * estimates based on source length + complexity hints; users can
 * always override.
 *
 * @param {{ sdkRegistry: any, chainId: string, code: string }} params
 * @returns {Promise<number>}
 */
export async function contractSuggestGasLimit({ sdkRegistry, chainId, code }) {
    if (!sdkRegistry) throw new Error('contractSuggestGasLimit: sdkRegistry is required');
    if (!chainId) throw new Error('contractSuggestGasLimit: chainId is required');
    if (typeof code !== 'string') throw new Error('contractSuggestGasLimit: code is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.contracts.suggestGasLimit(code);
}

/**
 * The contract identity (`meta.name` / `meta.description` / `meta.version`)
 * exported by a source, read statically.
 *
 * This is the deploy form's half of CONTRACT_META_REQUIRED: the form shows what
 * the chain will record instead of asking the user for a label. It is a
 * separate seam from the deploy flows' own preflight because the form asks per
 * keystroke, long before any transaction exists.
 *
 * Answers `null` rather than throwing when the installed SDK predates the
 * check, so the form can show nothing instead of a stale or invented label.
 *
 * @param {{ sdkRegistry: any, chainId: string, code: string }} params
 * @returns {Promise<{ status: 'present' | 'absent' | 'undecidable' } | null>}
 */
export async function contractExportedMeta({ sdkRegistry, chainId, code }) {
    if (!sdkRegistry) throw new Error('contractExportedMeta: sdkRegistry is required');
    if (!chainId) throw new Error('contractExportedMeta: chainId is required');
    if (typeof code !== 'string') throw new Error('contractExportedMeta: code is required');
    return readExportedMeta(sdkRegistry.get(chainId), code);
}
