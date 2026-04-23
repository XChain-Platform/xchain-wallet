// Plain-English action decoder — §21.1 / §30.
//
// Translates the raw protocol-shaped action payload (uppercase field
// names, string-encoded amounts) into UI-friendly strings the sign
// screens render. Pure function — no vault, no SDK, no network — so
// both shells can use the same decoder and the logic is trivial to
// smoke-test.
//
// Phase 1 covers SEND and SWEEP per §39.1 ("Core actions with
// dedicated authoring forms"); every other ACTION type gets a
// generic fallback that pretty-prints the params and surfaces a
// "no plain-English summary yet" warning. Dedicated decoders for
// ISSUE / MINT / DISPENSER / etc. land alongside their authoring
// forms in later phases.

/**
 * @typedef {Object} DecodedAction
 * @property {string} summary          one-line plain-English recap
 * @property {Array<{ label: string, value: string }>} details  label/value rows for the sign screen
 * @property {string[]} warnings       red-flag lines the UI must show
 */

/**
 * @param {object} opts
 * @param {string} opts.action
 * @param {Record<string, unknown>} [opts.params]
 * @param {string} [opts.chainId]
 * @param {import('../registry/index.js').ChainRegistry} [opts.chainRegistry]
 * @returns {DecodedAction}
 */
export function decodeAction({ action, params, chainId, chainRegistry }) {
    const p = params || {};
    const descriptor = chainRegistry && chainId ? chainRegistry.get(chainId) : null;
    const chainName = descriptor?.displayName ?? chainId ?? '';
    const chainSuffix = chainName ? ` on ${chainName}` : '';

    if (action === 'SEND') {
        const asset = str(p.TICK);
        const amount = str(p.AMOUNT);
        const dest = str(p.DESTINATION);
        const memo = str(p.MEMO);
        return {
            summary: `Send ${amount || '?'} ${asset || '?'}${chainSuffix} to ${dest || '?'}`,
            details: [
                { label: 'Asset', value: asset },
                { label: 'Amount', value: amount },
                { label: 'Destination', value: dest },
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                ...(memo && /[|;]/.test(memo)
                    ? ['Memo contains | or ; — the protocol will reject this transaction.']
                    : []),
                ...(!amount || Number(amount) <= 0
                    ? ['Amount is not positive.']
                    : []),
                ...(!dest ? ['Destination is empty.'] : []),
            ],
        };
    }

    if (action === 'SWEEP') {
        const dest = str(p.DESTINATION);
        const flags = p.FLAGS !== undefined && p.FLAGS !== null ? str(p.FLAGS) : '';
        const memo = str(p.MEMO);
        return {
            summary: `Sweep all assets${chainSuffix} to ${dest || '?'}`,
            details: [
                { label: 'Destination', value: dest },
                ...(flags ? [{ label: 'Flags', value: flags }] : []),
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                'Sweep moves every balance at the source address. Double-check the destination.',
                ...(!dest ? ['Destination is empty.'] : []),
            ],
        };
    }

    // Fallback: unknown or later-phase action kinds.
    const paramEntries = Object.entries(p).map(([k, v]) => ({
        label: k,
        value: typeof v === 'string' ? v : safeJson(v),
    }));
    return {
        summary: `Sign ${action || 'unknown action'}${chainSuffix}`,
        details: paramEntries,
        warnings: [
            `No plain-English summary is available for "${action || 'unknown action'}" yet — review the parameters carefully before approving.`,
        ],
    };
}

function str(v) {
    if (v === undefined || v === null) return '';
    return String(v);
}

function safeJson(v) {
    try {
        return JSON.stringify(v);
    } catch (_err) {
        return String(v);
    }
}
