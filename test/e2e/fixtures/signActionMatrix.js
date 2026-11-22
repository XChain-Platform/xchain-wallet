// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export const MATRIX_STAGES = Object.freeze(['compose', 'describe', 'tamper', 'submit']);

export function matrixVerdict(result) {
    if (result === null || typeof result !== 'object') {
        throw new TypeError('matrix result must be an object');
    }
    if (typeof result.action !== 'string' || result.action.trim().length === 0) {
        throw new TypeError('matrix result action must be a non-empty string');
    }

    const failedStage = MATRIX_STAGES.find((stage) => result.stages?.[stage] !== true) ?? null;
    return {
        action: result.action,
        passed: failedStage === null,
        failedStage,
    };
}

export function cutSignActionLists(results, { authorable, gated = [] }) {
    const authorableSet = new Set(authorable);
    const gatedSet = new Set(gated);
    const verdicts = new Map();

    for (const action of gatedSet) {
        if (!authorableSet.has(action)) {
            throw new TypeError(`gated action ${String(action)} is not authorable`);
        }
    }

    for (const result of results) {
        const verdict = matrixVerdict(result);
        if (!authorableSet.has(verdict.action)) {
            throw new TypeError(`result action ${verdict.action} is not authorable`);
        }
        if (verdicts.has(verdict.action)) {
            throw new TypeError(`duplicate result for action ${verdict.action}`);
        }
        verdicts.set(verdict.action, verdict);
    }

    const enabled = [];
    const refused = {};

    for (const action of [...authorableSet].sort()) {
        const verdict = verdicts.get(action);
        if (!gatedSet.has(action) && verdict?.passed) {
            enabled.push(action);
        } else if (gatedSet.has(action)) {
            refused[action] = 'chain-gated';
        } else if (verdict) {
            refused[action] = `failed ${verdict.failedStage} on regtest`;
        } else {
            refused[action] = 'not yet proven on regtest';
        }
    }

    return {
        enabled: Object.freeze(enabled),
        refused: Object.freeze(refused),
    };
}
