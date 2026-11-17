// Title case helper for page titles built from a runtime word
// (a verb or action label) that cannot be edited as a literal.

// Operator ruling 7 (WALLET-UI-RULINGS G50, 2026-11-13): in a Title Case
// label the short prepositions (from, with, as, to, of, on, in, for, at, by),
// the articles (a, an, the) and the conjunctions (and, or, but) stay lower
// case unless they are the first or the last word.
// Exported so the label conformance guard reads Title Case by the same list.
export const TITLE_SMALL_WORDS = new Set([
    'a', 'an', 'the',
    'and', 'or', 'but',
    'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'to', 'with',
]);
const SMALL_WORDS = TITLE_SMALL_WORDS;

const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Capitalizes the first letter of every word except the small words above
 * when they sit between the first and the last word of the label (or of a
 * clause after a colon). A small word written with only its first letter
 * capitalized ("From") drops to lower case mid-label. Other capitals are kept
 * as written, so tickers, brand names and single letters stay as they are.
 *
 * @param {string} text
 * @returns {string}
 */
export function titleCase(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/(^|[\s-])([A-Za-z][^\s-]*)/g, (match, lead, word, offset) => {
        const core = word.replace(/[^A-Za-z]+$/, '');
        const lower = core.toLowerCase();
        if (!SMALL_WORDS.has(lower)) return /^[a-z]/.test(word) ? lead + capitalize(word) : match;
        // A short word inside a hyphenated compound reads as part of one word:
        // it leads the compound with a capital ("On-Chain") and keeps its case
        // after the hyphen ("Opt-in").
        if (lead === '-') return match;
        if (text.charAt(offset + match.length) === '-') return /^[a-z]/.test(word) ? lead + capitalize(word) : match;
        const before = text.slice(0, offset + lead.length).trimEnd();
        const after = word.slice(core.length) + text.slice(offset + match.length);
        const first = before === '' || /[:.?!]$/.test(before);
        const last = !/[A-Za-z0-9]/.test(after) || /^[^\sA-Za-z0-9]*[:.?!]/.test(after);
        if (first || last) return /^[a-z]/.test(word) ? lead + capitalize(word) : match;
        // "From" mid-label drops to "from"; "FROM" and a lone "A" stay as written.
        if (core.length > 1 && core === capitalize(lower)) return lead + word.charAt(0).toLowerCase() + word.slice(1);
        return match;
    });
}
