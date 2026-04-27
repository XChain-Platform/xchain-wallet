// Fee estimate — bridge between the §21.2 simulator + the §29.2 Max
// button and the proper §44.2 fee selector that lands in a later
// cluster. Keeps both surfaces honest: they get a defensible default
// rate keyed off the chain's coin family rather than the silent zero
// they had been feeding the simulator.
//
// All values are STATIC PLACEHOLDERS marked as such. They are sized
// for a typical 1-input / 2-output SEND tx (one recipient + change)
// and for the protocol minimum on coins that enforce one. When the
// SDK exposes a real fee endpoint (or §44.2 wires user-selectable
// rates), this flow swaps to that source while keeping the same
// return shape — so callers don't have to learn a new contract.
//
// Output is always `{ sats, source, confidence, ... }`. `source` is
// the truthful provenance of the value; surfaces show it next to the
// number so the user understands what they're looking at.

const PLACEHOLDER_FEES = /** @type {const} */ ({
    bitcoin: { sats: 1500, feeRate: '6 sat/vB', txSize: 250 },
    litecoin: { sats: 250, feeRate: '1 sat/vB', txSize: 250 },
    // DOGE protocol minimum: 1 DOGE/kB. A 250-byte tx ≈ 0.25 kB →
    // 0.25 DOGE = 25,000,000 koinu. Round up to 0.25 DOGE.
    dogecoin: { sats: 25_000_000, feeRate: '1 DOGE/kB', txSize: 250 },
});

/**
 * @typedef {object} FeeEstimate
 * @property {number} sats          absolute fee in coin base units (sats / koinu)
 * @property {string} coinAmount    same value as a decimal string at coin scale (8 decimals for BTC/LTC/DOGE)
 * @property {'static-placeholder' | 'sdk' | 'user'} source
 * @property {'low' | 'medium' | 'high'} confidence
 * @property {string} [rate]        human display, e.g., "6 sat/vB"
 * @property {number} [vsize]       assumed virtual size in bytes, when known
 */

/**
 * Estimate the network fee for a typical SEND transaction on the given
 * chain. Native sends use the placeholder table; asset / token sends
 * use the same number (the fee is paid in native coin regardless of
 * what's being moved).
 *
 * @param {object} opts
 * @param {string} opts.chainId
 * @param {{ get: (id: string) => any }} opts.chainRegistry
 * @returns {FeeEstimate | null}
 */
export function estimateNativeSendFee({ chainId, chainRegistry } = {}) {
    if (typeof chainId !== 'string' || !chainRegistry) return null;
    const desc = chainRegistry.get(chainId);
    const coin = desc?.coin;
    if (!coin) return null;
    const row = PLACEHOLDER_FEES[coin];
    if (!row) {
        return {
            sats: 0,
            coinAmount: '0',
            source: 'static-placeholder',
            confidence: 'low',
        };
    }
    return {
        sats: row.sats,
        coinAmount: satsToCoinDecimal(row.sats),
        source: 'static-placeholder',
        confidence: 'low',
        rate: row.feeRate,
        vsize: row.txSize,
    };
}

/**
 * Convert sats (BTC/LTC/DOGE base unit; 8 decimals) to a tidy decimal
 * string at coin scale. Trailing zeros stripped for display; the value
 * is exact.
 *
 * @param {number} sats
 * @returns {string}
 */
export function satsToCoinDecimal(sats) {
    if (!Number.isFinite(sats) || sats < 0) return '0';
    if (sats === 0) return '0';
    const intPart = Math.floor(sats / 1e8);
    const fracPart = sats - intPart * 1e8;
    if (fracPart === 0) return String(intPart);
    const frac = String(fracPart).padStart(8, '0').replace(/0+$/, '');
    return `${intPart}.${frac}`;
}
