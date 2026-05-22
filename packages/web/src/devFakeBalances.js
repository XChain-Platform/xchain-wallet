// Dev-only fake balance dataset used by `createDevMockSdk` so the
// wallet UI has realistic data to render even when no real explorer
// is configured. Strictly non-production: shipped to the bundle only
// because it lives next to the dev-mock SDK; the real SDK overrides
// the dev-mock at boot when `xchain-sdk` resolves cleanly.
//
// Native balances per chain (the user-requested totals):
//   BTC  → 50.00000000     ( 5_000_000_000 sats)
//   LTC  → 30.00000000     ( 3_000_000_000 ltoshi)
//   DOGE → 100,000.00000000 (10_000_000_000_000 atomic units)
//
// `fiatRate` is USD per ONE whole unit (after dividing by divisibility).
// Used by the UI to render a per-row USD line and roll up a portfolio
// total. Numbers picked to look plausible in 2026 — not real prices.

/**
 * @typedef {Object} FakeToken
 * @property {string} tick         ticker — uppercase, no whitespace
 * @property {string} displayName   user-friendly name
 * @property {string} description   one-line subtitle
 * @property {string} quantity      atomic-unit string
 * @property {number} divisibility  decimals to apply for display
 * @property {'native' | 'token' | 'subtoken'} kind
 * @property {number} fiatRate      USD per whole unit
 */

/** Map a chain id → coin family for native-symbol lookup. */
function coinForChain(chainId) {
    if (typeof chainId !== 'string') return 'bitcoin';
    if (chainId.startsWith('litecoin-')) return 'litecoin';
    if (chainId.startsWith('dogecoin-')) return 'dogecoin';
    return 'bitcoin';
}

const NATIVE_BY_COIN = {
    bitcoin: {
        tick: 'BTC',
        displayName: 'Bitcoin',
        description: 'The native coin of the Bitcoin network.',
        quantity: '5000000000',          // 50 BTC
        divisibility: 8,
        kind: 'native',
        fiatRate: 65000,
    },
    litecoin: {
        tick: 'LTC',
        displayName: 'Litecoin',
        description: 'The native coin of the Litecoin network.',
        quantity: '3000000000',          // 30 LTC
        divisibility: 8,
        kind: 'native',
        fiatRate: 80,
    },
    dogecoin: {
        tick: 'DOGE',
        displayName: 'Dogecoin',
        description: 'The native coin of the Dogecoin network.',
        quantity: '10000000000000',      // 100,000 DOGE (8 decimals)
        divisibility: 8,
        kind: 'native',
        fiatRate: 0.1,
    },
};

// 40 fake tokens. Tuple shape:
//   [ ticker, display name, description, quantity, divisibility, kind, fiat-rate ]
/** @type {Record<string, FakeToken[]>} */
const TOKENS_BY_COIN = {
    bitcoin: [
        ['PEPECASH',   'Pepe Cash',          'The original meme cash on Counterparty.', '125000000000000', 8, 'token',    0.0001],
        ['RAREPEPE',   'Rare Pepe',          'Iconic 2016 collectible card series.',    '17',              0, 'token',    250],
        ['XCP',        'Counterparty',       'Native tick of the Counterparty layer.', '4250000000',      8, 'token',    1.5],
        ['DANKEST',    'Dankest Token',      'XChain Platform governance token.',       '50000000000000',  8, 'token',    0.05],
        ['XCHAINGOV',  'XChain Governance',  'Vote on XChain Platform proposals.',      '125000000000',    8, 'token',    2],
        ['SATOSHIS',   'Satoshis',           'Sats on Bitcoin, tokenised.',             '8888800000000',   8, 'token',    0.000001],
        ['BTCNFT',     'Bitcoin NFT',        'Limited 1/1 collectible.',                '1',               0, 'token',    50],
        ['HODL',       'HODL Token',         'Diamond-handed devotion.',                '690420000000',    8, 'token',    0.001],
        ['MAFIACASH',  'Mafia Cash',         'Honor among coiners.',                    '13370000000000',  8, 'token',    0.00005],
        ['LAMBO',      'Lambo Coin',         'When Lambo? Now.',                        '4200000000',      8, 'token',    5],
        ['DIAMOND',    'Diamond Hands',      'For those who never sell.',               '15000000000000',  8, 'token',    0.0001],
        ['MOONSHOT',   'Moonshot',           'Aim for the stars.',                      '21000000000',     8, 'token',    0.01],
        ['ROCKET',     'Rocket Fuel',        'Liftoff in three… two… one…',             '750000000000',    8, 'token',    0.0001],
        ['STAMPS',     'Bitcoin Stamps',     'Permanent on-chain art.',                 '847',             0, 'token',    0.5],
        ['ORDINALS',   'Ordinals',           'Inscriptions on individual sats.',        '21',              0, 'token',    30],
        ['USDX',       'USD-X',              'Dev-mock USD stablecoin.',                '50000000000',     8, 'token',    1],
        ['EURX',       'EUR-X',              'Dev-mock EUR stablecoin.',                '20000000000',     8, 'token',    1.08],
        ['GOLDX',      'Gold-X',             'Pegged to one milligram of gold.',        '480000000000',    8, 'token',    0.09],
    ],
    litecoin: [
        ['LITEGEM',    'Lite Gem',           'Litecoin native gem token.',              '3300000000000',   8, 'token',    0.001],
        ['SCRYPT',     'Scrypt Token',       'Honoring the algo.',                      '128000000000',    8, 'token',    0.10],
        ['DOGEFOOD',   'Doge Food',          'Cross-chain meme economy.',               '50000000000',     8, 'token',    0.0001],
        ['CHARLIE',    'Charlie',            'Tribute coin.',                           '1500000000',      8, 'token',    0.20],
        ['LITESTAMP',  'Lite Stamp',         'Ordinals-style stamps on LTC.',           '420',             0, 'token',    5],
        ['MWEB',       'MWEB Token',         'MimbleWimble extension block.',           '88000000000',     8, 'token',    0.05],
        ['LIGHTNING',  'Lightning Token',    'Off-chain payment unit.',                 '7500000000',      8, 'token',    0.10],
        ['WAGMI',      'WAGMI',              'We are gonna make it.',                   '2500000000000',   8, 'token',    0.001],
        ['XCHAINFEE',  'XChain Fee Credit',  'Pre-paid relay fees.',                    '95000000000',     8, 'token',    0.50],
        ['SILVERX',    'Silver-X',           'Pegged to one ounce of silver.',          '125000000000',    8, 'token',    25],
    ],
    dogecoin: [
        ['SHIBE',      'Shibe Token',        'Such token. Very test.',                  '1000000000000000', 8, 'token',   0.0000001],
        ['MUCHWOW',    'Much Wow',           'So balance. Very Doge.',                  '150000000000000',  8, 'token',   0.0001],
        ['MOONDOGE',   'Moon Doge',          'To the moon, very fast.',                 '88800000000000',   8, 'token',   0.000001],
        ['DOGEMOON',   'Doge Moon',          'Inverse meme.',                           '420690000000000',  8, 'token',   0.0000001],
        ['ELONCOIN',   'Elon Coin',          'Tweet-driven volatility.',                '13370000000000',   8, 'token',   0.001],
        ['BARK',       'Bark Token',         'Woof.',                                   '50000000000000',   8, 'token',   0.0001],
        ['TIPDOGE',    'Tip Doge',           'Reddit tipping legacy.',                  '99999900000000',   8, 'token',   0.0000001],
        ['DOGEPUNK',   'Doge Punk',          'Pixel-art collectible series.',           '24',               0, 'token',   5],
        ['DOGENFT',    'Doge NFT',           'Limited collectible.',                    '1',                0, 'token',   25],
        ['MEMECASH',   'Meme Cash',          'The settlement layer for memes.',         '25000000000000',   8, 'token',   0.001],
        ['DOGEHODL',   'Doge HODL',          'Hold the Doge.',                          '888000000000000',  8, 'token',   0.0000001],
        ['SHIBARMY',   'Shib Army',          'Salute.',                                 '999999000000000',  8, 'token',   0.00000005],
    ],
};

/**
 * Stable per-address balance generator. Always returns the FULL chain
 * balance (50 BTC, 40+ tokens, etc.) on every address so the dev UI
 * has something to render regardless of which address is queried.
 *
 * @param {string} address
 * @param {string} chainId
 * @returns {{ address: string, chain: string, native: FakeToken, tokens: FakeToken[] }}
 */
export function fakeBalanceFor(address, chainId) {
    const coin = coinForChain(chainId);
    const native = NATIVE_BY_COIN[coin] || NATIVE_BY_COIN.bitcoin;
    const tokens = (TOKENS_BY_COIN[coin] || []).map(([tick, displayName, description, quantity, divisibility, kind, fiatRate]) => ({
        tick, displayName, description, quantity, divisibility, kind, fiatRate,
    }));
    return {
        address,
        chain: chainId,
        native,
        tokens: tokens,
    };
}
