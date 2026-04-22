// Bundled chain registry snapshot. A future runtime-refresh path (§9.7)
// will merge updates from sdk.hub config; until then, this is the
// authoritative list shipped with each wallet release.

import { bitcoinDescriptors } from './bitcoin.js';
import { dogecoinDescriptors } from './dogecoin.js';
import { litecoinDescriptors } from './litecoin.js';

/** @type {import('../validate.js').ChainDescriptor[]} */
export const BUNDLED_DESCRIPTORS = [
    ...bitcoinDescriptors,
    ...dogecoinDescriptors,
    ...litecoinDescriptors,
];

export { bitcoinDescriptors, dogecoinDescriptors, litecoinDescriptors };
