// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { contractMetaOf, extractSingle } from '../routes/contractResponseShape.js';

/**
 * The contract a contract form acts on. It starts as the contract the page
 * that opened the form named, follows that page if it names another, and
 * changes when the user picks another contract from the field's list icon.
 *
 * @param {string} chainId                 the opening page's chain
 * @param {string | number} contractActionIndex  the opening page's contract
 * @returns {{
 *   chainId: string,
 *   contractActionIndex: string,
 *   pickerOpen: boolean,
 *   openPicker: () => void,
 *   closePicker: () => void,
 *   pick: (chainId: string, contractActionIndex: string) => void,
 * }}
 */
export function useContractTarget(chainId, contractActionIndex) {
    const [target, setTarget] = useState(() => ({
        chainId,
        contractActionIndex: contractActionIndex == null ? '' : String(contractActionIndex),
    }));
    const [pickerOpen, setPickerOpen] = useState(false);
    useEffect(() => {
        const index = contractActionIndex == null ? '' : String(contractActionIndex);
        setTarget((prev) => (prev.chainId === chainId && prev.contractActionIndex === index
            ? prev
            : { chainId, contractActionIndex: index }));
    }, [chainId, contractActionIndex]);
    return {
        chainId: target.chainId,
        contractActionIndex: target.contractActionIndex,
        pickerOpen,
        openPicker: () => setPickerOpen(true),
        closePicker: () => setPickerOpen(false),
        pick: (nextChainId, nextIndex) => {
            setTarget({ chainId: nextChainId, contractActionIndex: String(nextIndex) });
            setPickerOpen(false);
        },
    };
}

/**
 * One contract row from the explorer, read once per contract: null while it
 * loads, when the lookup fails, or when the shell has no
 * `getContractByActionIndex`. Forms read the name, the owner-withdraw answer
 * and any other field off this one row rather than asking again.
 *
 * @param {object} args
 * @param {any} args.messaging
 * @param {string | null | undefined} args.chainId
 * @param {string | null | undefined} args.contractActionIndex
 * @returns {any | null}
 */
export function useContractRow({ messaging, chainId, contractActionIndex }) {
    const [row, setRow] = useState(/** @type {any | null} */ (null));
    useEffect(() => {
        setRow(null);
        if (!chainId || !contractActionIndex) return undefined;
        if (typeof messaging?.getContractByActionIndex !== 'function') return undefined;
        let cancelled = false;
        messaging.getContractByActionIndex({ chainId, contractActionIndex })
            .then((resp) => { if (!cancelled) setRow(extractSingle(resp) || null); })
            .catch(() => { /* unknown: the form keeps its behaviour without the row */ });
        return () => { cancelled = true; };
    }, [messaging, chainId, contractActionIndex]);
    return row;
}

/**
 * The name a contract field shows: the name the contract exported, else
 * "Unnamed contract", the same words every contract surface uses.
 *
 * @param {any} row
 * @returns {string}
 */
export function contractFieldName(row) {
    return contractMetaOf(row).name || 'Unnamed contract';
}
