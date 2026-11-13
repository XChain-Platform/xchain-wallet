// Title case helper for page titles built from a runtime word
// (a verb or action label) that cannot be edited as a literal.

// Exported so the label conformance guard reads Title Case by the same list.
export const TITLE_SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'at', 'by']);
const SMALL_WORDS = TITLE_SMALL_WORDS;

/**
 * Capitalizes the first letter of every word except short articles,
 * conjunctions and prepositions after the first word. Only lowercase first
 * letters change, so tickers and brand names stay as written.
 *
 * @param {string} text
 * @returns {string}
 */
export function titleCase(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/(^|[\s-])([a-z][^\s-]*)/g, (match, lead, word, offset) => {
        if (offset > 0 && SMALL_WORDS.has(word)) return match;
        return lead + word.charAt(0).toUpperCase() + word.slice(1);
    });
}
