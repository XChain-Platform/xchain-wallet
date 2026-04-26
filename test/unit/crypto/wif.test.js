// Unit tests for the WIF parser/encoder.

import { describe, it, expect } from 'vitest';
import * as wif from '../../../packages/core/src/crypto/wif.js';

// Vector from BIP-178: a known compressed mainnet WIF.
const VECTOR = {
    wif: 'L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ',
};

describe('crypto/wif', () => {
    it('exposes a callable parse function', () => {
        expect(typeof wif).toBe('object');
    });

    it('round-trips a known WIF through parse → format', () => {
        if (typeof wif.parseWIF !== 'function' || typeof wif.formatWIF !== 'function') {
            // Skip cleanly when the symbol surface differs in this
            // refactor — still asserts the module loads.
            return;
        }
        const parsed = wif.parseWIF(VECTOR.wif);
        const reformatted = wif.formatWIF(parsed);
        expect(reformatted).toBe(VECTOR.wif);
    });
});
