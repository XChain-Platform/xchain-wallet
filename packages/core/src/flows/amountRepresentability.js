// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settles the SDK's AMOUNT_REPRESENTABILITY gap, declared wherever the newer amount rule is unarmed.
// Drops it only when every amount passes that rule under the SDK's own validator; anything
// unreadable (unlisted action, batch, token lookup miss, no validator) keeps it.

export const AMOUNT_REPRESENTABILITY = 'AMOUNT_REPRESENTABILITY';

// The field naming the tick whose decimals bind AMOUNT, as the SDK's checks pair them.
const AMOUNT_TICK_FIELD = Object.freeze({
    SEND: 'TICK',
    DESTROY: 'TICK',
    MINT: 'TICK',
    AIRDROP: 'TICK',
    DIVIDEND: 'DIVIDEND_TICK',
});

/**
 * @typedef {Object} AmountRules
 * @property {(decimals: string, amount: unknown, armed: boolean) => boolean} isValidAmountFormatWhere
 * @property {(token: object) => string|null} tokenDecimals
 */

function sdkExport(mod, name) {
    if (typeof mod?.[name] === 'function') return mod[name];
    if (typeof mod?.default?.[name] === 'function') return mod.default[name];
    return null;
}

/**
 * The validator pair from the SDK's own pre-flight modules, or null when either
 * is missing. Takes the module objects so core never imports the SDK.
 *
 * @param {{ numeric?: any, amountFormat?: any }} [mods]  src/preflight/numeric.js and src/preflight/checks/amount_format.js
 * @returns {AmountRules|null}
 */
export function amountRulesFromSdk({ numeric, amountFormat } = {}) {
    const isValidAmountFormatWhere = sdkExport(numeric, 'isValidAmountFormatWhere');
    const tokenDecimals = sdkExport(amountFormat, 'tokenDecimals');
    if (!isValidAmountFormatWhere || !tokenDecimals) return null;
    return Object.freeze({ isValidAmountFormatWhere, tokenDecimals });
}

/**
 * Every amount a parsed action carries, each with the tick that binds it, or
 * null when the wallet cannot say which amounts the action carries.
 *
 * @param {any} parsed  the SDK decoder's ParsedAction for the composed action string
 * @returns {Array<{ tick: string, amount: unknown }>|null}
 */
export function actionAmounts(parsed) {
    if (!parsed || parsed.ok !== true || typeof parsed.action !== 'string') return null;
    if (parsed.commands || String(parsed.version) !== '0') return null;
    const tickField = AMOUNT_TICK_FIELD[parsed.action.toUpperCase()];
    const params = parsed.params;
    if (!tickField || !params || typeof params !== 'object') return null;
    const ticks = [].concat(params[tickField] ?? []).map((t) => String(t ?? ''));
    const amounts = [].concat(params.AMOUNT ?? []);
    if (ticks.length === 0 || amounts.length === 0) return null;
    // Legs pair by index, and a short tick list repeats its last tick, as the SDK reads them.
    const legs = amounts.map((amount, i) => ({ tick: ticks[Math.min(i, ticks.length - 1)], amount }));
    return legs.some((leg) => leg.tick === '') ? null : legs;
}

// The token row inside an explorer answer, unwrapped the way the SDK's pre-flight reads it.
function tokenRow(res) {
    if (!res || typeof res !== 'object') return null;
    const t = res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data : res;
    if (Array.isArray(t)) return t[0] || null;
    return t;
}

function isAmountItem(u) {
    return u?.check === AMOUNT_REPRESENTABILITY;
}

/**
 * The report with AMOUNT_REPRESENTABILITY dropped when every amount passes the
 * newer rule, else the same report. Never mutates the report it is given.
 *
 * @param {any} report               the SDK pre-flight report
 * @param {Object} opts
 * @param {any} opts.parsed          the SDK decoder's ParsedAction for the same action string
 * @param {AmountRules|null} opts.rules
 * @param {(tick: string) => Promise<any>} opts.tokenFor  explorer token lookup
 * @returns {Promise<any>}
 */
export async function settleAmountRepresentability(report, { parsed, rules, tokenFor } = {}) {
    if (!report || !Array.isArray(report.unverified) || !report.unverified.some(isAmountItem)) return report;
    if (!rules || typeof tokenFor !== 'function') return report;
    const legs = actionAmounts(parsed);
    if (!legs) return report;
    try {
        const ticks = [...new Set(legs.map((leg) => leg.tick))];
        const rows = await Promise.all(ticks.map((tick) => tokenFor(tick)));
        const decimalsByTick = new Map(ticks.map((tick, i) => {
            const row = tokenRow(rows[i]);
            return [tick, row ? rules.tokenDecimals(row) : null];
        }));
        for (const { tick, amount } of legs) {
            const decimals = decimalsByTick.get(tick);
            if (decimals === null || decimals === undefined) return report;
            if (rules.isValidAmountFormatWhere(decimals, amount, true) !== true) return report;
        }
    } catch {
        return report;
    }
    return { ...report, unverified: report.unverified.filter((u) => !isAmountItem(u)) };
}
