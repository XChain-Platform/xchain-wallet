// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import validate from './validate.js';

export function createMessageValidator(kinds, { postChecks = {} } = {}) {
    function explainMessage(kind, value) {
        if (!Object.hasOwn(kinds, kind)) return ['$kind'];

        const paths = validate(kinds[kind], value);
        if (paths.length > 0) return paths;

        const postCheck = Object.hasOwn(postChecks, kind) ? postChecks[kind] : undefined;
        return postCheck ? postCheck(value) : [];
    }

    return {
        validateMessage: (kind, value) => explainMessage(kind, value).length === 0,
        explainMessage,
    };
}
