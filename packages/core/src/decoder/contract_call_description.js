// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { revealHiddenText } from '../shared/utils/textHardening.js';

// What a contract receives is a list of strings, compared byte for byte. The
// SDK description joins them into one comma-separated line (so the two
// arguments `a, b` and `c` read like three) and a renderer hardens that line
// (so a zero-width character or a doubled space disappears). A DEPLOY
// description carries no constructor arguments at all, though the constructor
// runs once and the deploy is immutable. These rows state each argument on its
// own line, exactly as it is sent.

const ARGUMENTS_LABEL = 'Arguments';

function asList(value) {
    if (Array.isArray(value)) return value.map((entry) => String(entry));
    if (value === undefined || value === null || value === '') return [];
    return [String(value)];
}

function argumentRows(args, label, indent = '') {
    return args.map((arg, i) => ({
        label: `${indent}${label} ${i + 1}`,
        value: revealHiddenText(arg),
    }));
}

function withExecuteArguments(decoded, parsed) {
    const args = asList(parsed?.params?.PARAMS);
    if (args.length === 0) return decoded;
    const details = Array.isArray(decoded.details) ? decoded.details : [];
    const at = details.findIndex((row) => row?.label === ARGUMENTS_LABEL);
    const rows = argumentRows(args, 'Argument');
    if (at < 0) return { ...decoded, details: [...details, ...rows] };
    return { ...decoded, details: [...details.slice(0, at), ...rows, ...details.slice(at + 1)] };
}

function withDeployConstructorArguments(decoded, parsed) {
    const args = asList(parsed?.params?.CONSTRUCTOR_PARAMS);
    if (args.length === 0) return decoded;
    const details = Array.isArray(decoded.details) ? decoded.details : [];
    const rows = argumentRows(args, 'Constructor argument');
    const gas = details.findIndex((row) => row?.label === 'Gas limit');
    const at = gas < 0 ? details.length : gas + 1;
    return { ...decoded, details: [...details.slice(0, at), ...rows, ...details.slice(at)] };
}

// A batch description flattens each step into `Step n` followed by its rows
// indented two spaces, so a step's arguments are found by walking those labels.
function withBatchExecuteArguments(decoded, parsed) {
    const commands = Array.isArray(parsed?.commands) ? parsed.commands : [];
    const details = Array.isArray(decoded.details) ? decoded.details : [];
    const out = [];
    let step = -1;
    for (const row of details) {
        const stepMatch = /^Step (\d+)$/.exec(String(row?.label ?? ''));
        if (stepMatch) step = Number(stepMatch[1]) - 1;
        const command = step >= 0 ? commands[step] : null;
        if (row?.label === `  ${ARGUMENTS_LABEL}` && command?.ok && command.action === 'EXECUTE') {
            const args = asList(command.params?.PARAMS);
            if (args.length > 0) {
                out.push(...argumentRows(args, 'Argument', '  '));
                continue;
            }
        }
        out.push(row);
    }
    return { ...decoded, details: out };
}

/**
 * Replace the SDK's contract-call rows with one row per argument, spelled out
 * exactly as sent: EXECUTE arguments (alone or inside a BATCH step) and DEPLOY
 * constructor arguments. Every other word stays the SDK's.
 *
 * @param {object | null} decoded
 * @param {{ action?: string, params?: object, commands?: any[] } | null} parsed
 * @returns {object | null}
 */
export function withContractCallDescriptions(decoded, parsed) {
    if (!decoded || !parsed) return decoded;
    const action = String(parsed.action || '').toUpperCase();
    if (action === 'EXECUTE') return withExecuteArguments(decoded, parsed);
    if (action === 'DEPLOY') return withDeployConstructorArguments(decoded, parsed);
    if (action === 'BATCH') return withBatchExecuteArguments(decoded, parsed);
    return decoded;
}
