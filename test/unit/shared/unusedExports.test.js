// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

const CASES = [
    ['components/settings/BackupSection.jsx', ['restoreLabelsMessage']],
    ['hooks/useCoinpayObligations.js', ['isPendingForPayer', 'extractRows']],
    ['hooks/useConfirmAction.js', ['isCredentialFailure']],
    ['hooks/useGovernanceAddressesPresent.js', ['governanceChainIds']],
    ['keyboard/useMenuKeys.js', ['handleMenuKeyDown']],
    ['keyboard/useTablistKeys.js', ['handleTablistKeyDown']],
    ['routes/BetFeedDetail.jsx', ['betAmountError']],
    ['routes/ImportWallet.jsx', ['labelSyncRestoredMessage']],
    ['routes/MySwapsView.jsx', ['swapStateOf']],
    ['routes/Send.jsx', ['isPositiveDecimalAmount']],
    ['utils/dispenserPricing.js', ['isFiatPricedRow', 'oraclePriceLabel', 'mergeOfferState']],
    ['utils/preflightFindingKey.js', ['consensusRefusalReason']],
    ['utils/submitFailureMessage.js', ['isNativeFeeForfeit']],
];

function namedExports(source) {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const names = new Set();
    for (const node of ast.program.body) {
        if (node.type !== 'ExportNamedDeclaration') continue;
        if (node.declaration?.id) names.add(node.declaration.id.name);
        for (const declaration of node.declaration?.declarations || []) {
            if (declaration.id.type === 'Identifier') names.add(declaration.id.name);
        }
        for (const specifier of node.specifiers) names.add(specifier.exported.name);
    }
    return names;
}

describe('shared implementation details stay private', () => {
    it.each(CASES)('%s omits dead named exports', (relativePath, privateNames) => {
        const file = resolve(
            dirname(fileURLToPath(import.meta.url)),
            '../../../packages/core/src/shared',
            relativePath,
        );
        const exports = namedExports(readFileSync(file, 'utf8'));
        for (const name of privateNames) expect(exports.has(name)).toBe(false);
    });
});
