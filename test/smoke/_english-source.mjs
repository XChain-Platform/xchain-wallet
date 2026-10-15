// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Preloaded into every smoke by _run-smokes.js. Source-reading smokes assert
// on the English copy a component renders, and that copy now lives in the
// locale dictionary behind t('key'). This swaps plain t('key') calls in wallet
// source files back to their English text as the smoke reads them, so a smoke
// keeps checking what the user sees. A smoke that audits the t() calls
// themselves sets XC_SMOKE_RAW_SOURCE=1 (or is listed in RAW_SOURCE_SMOKES in
// the runner) and reads the files untouched.

import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { withEnglishCopy } from '../helpers/englishSource.js';

if (!process.env.XC_SMOKE_RAW_SOURCE) {
    const read = fs.readFileSync;
    const WALLET_SOURCE = /[\\/]packages[\\/][^\\/]+[\\/](?:src|renderer)[\\/].*\.jsx?$/;
    fs.readFileSync = function readFileSync(file, options) {
        const out = read.apply(this, arguments);
        const encoding = typeof options === 'string' ? options : options?.encoding;
        if (encoding && typeof out === 'string' && typeof file === 'string'
            && WALLET_SOURCE.test(file) && !/i18n[\\/]locales/.test(file)) {
            return withEnglishCopy(out);
        }
        return out;
    };
    // Smokes import readFileSync by name; hand the patched function to them.
    syncBuiltinESMExports();
}

