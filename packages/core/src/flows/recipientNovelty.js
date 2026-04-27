// Recipient novelty check — §21.4 test-send protection.
//
// Pure helper. The Send route already fetches contacts + send history
// for autocomplete (Step 1). This function reuses that data to decide
// whether the entered destination is one the user has interacted with
// before. When `everSentTo` is false AND `knownAsContact` is false,
// Send.jsx may surface the test-send banner.
//
// Returns boolean signals only — the threshold + UX decision lives
// in the calling shell.

const HISTORY_ADDR_FIELDS = ['destination', 'DESTINATION', 'recipient'];

/**
 * @typedef {object} NoveltyResult
 * @property {boolean} everSentTo        the user has sent to this address before from any of their own addresses on this chain
 * @property {boolean} knownAsContact    the address matches an entry in the user's contact book on this chain
 * @property {boolean} novel             true ⇒ neither everSentTo nor knownAsContact
 */

/**
 * @param {object} opts
 * @param {string} opts.address                                    the destination the user just entered
 * @param {string} [opts.chainCoin]                                coin family (matches contact entry.chain)
 * @param {Array<{ name?: string, entries?: Array<{ chain?: string, address?: string }> }>} [opts.contacts]
 * @param {Array<Record<string, any>>} [opts.historyRows]
 * @returns {NoveltyResult}
 */
export function checkRecipientNovelty({
    address,
    chainCoin,
    contacts = [],
    historyRows = [],
} = {}) {
    if (typeof address !== 'string' || address.length === 0) {
        return { everSentTo: false, knownAsContact: false, novel: false };
    }

    let knownAsContact = false;
    if (typeof chainCoin === 'string' && chainCoin.length > 0) {
        for (const c of contacts) {
            for (const e of c?.entries || []) {
                if (e?.chain === chainCoin && e?.address === address) {
                    knownAsContact = true;
                    break;
                }
            }
            if (knownAsContact) break;
        }
    }

    let everSentTo = false;
    for (const row of historyRows) {
        const action = String(row?.action ?? row?.ACTION ?? '').toUpperCase();
        if (action !== 'SEND') continue;
        for (const f of HISTORY_ADDR_FIELDS) {
            if (row[f] === address) {
                everSentTo = true;
                break;
            }
        }
        if (everSentTo) break;
    }

    return {
        everSentTo,
        knownAsContact,
        novel: !everSentTo && !knownAsContact,
    };
}
