// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { t } from '../../i18n/index.js';
import { contractMetaOf } from './contractResponseShape.js';

// The contract and method being signed, named first on the Confirm facts card (G127).
export function contractCallFacts({ index, row, method }) {
    const name = String(contractMetaOf(row).name || '').trim();
    return [
        { label: t('execute.contract'), value: `#${index}` },
        ...(name ? [{ label: t('execute.contractName'), value: name }] : []),
        ...(method ? [{ label: t('execute.method'), value: method }] : []),
    ];
}
