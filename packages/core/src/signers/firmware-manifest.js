// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Firmware manifest — §18.4. Bundled at build time, consulted by
// `checkFirmware` to verdict a device's reported version.
//
// Why JS not JSON: this manifest ships *inside* the wallet bundle so
// every release pins its own version of the safety data. A JSON file
// would either need an explicit fetch (every wallet boot taking a
// network hit, with a fallback path that has to mirror the JSON
// anyway) or a build-time JSON-to-JS step, which is one more step in
// the pipeline for no real benefit. Keeping it as a JS module makes
// the import graph clean for both Vite (bundles the constant) and
// Node (resolves it like any other ESM dep). Smokes pin this design
// choice — see `signers/signer-scaffold.smoke.js`.
//
// Updating the manifest: when a new firmware advisory or release lands
// upstream (Trezor / Ledger), update the relevant model's `minimum`,
// `recommended`, `knownVulnerable`, or `unsupported` fields, bump
// `generatedAt`, then ship a new wallet release. The shipped wallet
// version's manifest is the trust boundary — users on older releases
// see older advisories. A runtime-fetch path that lets advisories
// propagate between releases is tracked as Cluster N FOLLOWUP 1.
//
// Schema:
//
//   {
//     schema:       'firmware-manifest/1' (string, immutable)
//     generatedAt:  ISO date (string)
//     walletVersion: WALLET_VERSION at release time (string)
//     vendors: {
//       <vendorKey>: {
//         updateUrl: string
//         models: {
//           <modelKey>: {
//             displayName:     string
//             minimum:         dotted-version string (refuse-to-sign floor)
//             recommended:     dotted-version string (nudge floor)
//             knownVulnerable: array of exact / prefix / major-x patterns
//             unsupported:     array of same
//           }
//         }
//       }
//     }
//   }
//
// Match patterns in `knownVulnerable` / `unsupported` accept:
//   - Exact:    "1.11.2"
//   - Prefix:   "1.11."  (matches every "1.11.x")
//   - Major-x:  "1.x"    (matches every "1.x.x")
// See `checkFirmware.js`'s findMatch for the resolution logic.

import { WALLET_VERSION } from '../buildInfo.js';

export const FIRMWARE_MANIFEST = {
    schema: 'firmware-manifest/1',
    generatedAt: '2026-04-27',
    walletVersion: WALLET_VERSION,
    vendors: {
        trezor: {
            updateUrl: 'https://trezor.io/start/',
            models: {
                T1B1: {
                    displayName: 'Trezor Model One',
                    minimum: '1.10.0',
                    recommended: '1.12.1',
                    knownVulnerable: [],
                    unsupported: [],
                },
                T2T1: {
                    displayName: 'Trezor Model T',
                    minimum: '2.4.0',
                    recommended: '2.7.2',
                    knownVulnerable: [],
                    unsupported: [],
                },
                T2B1: {
                    displayName: 'Trezor Safe 3',
                    minimum: '2.6.4',
                    recommended: '2.7.2',
                    knownVulnerable: [],
                    unsupported: [],
                },
                T3T1: {
                    displayName: 'Trezor Safe 5',
                    minimum: '2.8.0',
                    recommended: '2.8.7',
                    knownVulnerable: [],
                    unsupported: [],
                },
            },
        },
        ledger: {
            updateUrl: 'https://www.ledger.com/ledger-live',
            models: {
                nanoS: {
                    displayName: 'Ledger Nano S',
                    minimum: '2.1.0',
                    recommended: '2.1.0',
                    knownVulnerable: [],
                    unsupported: ['1.x'],
                },
                nanoSP: {
                    displayName: 'Ledger Nano S Plus',
                    minimum: '1.0.0',
                    recommended: '1.1.0',
                    knownVulnerable: [],
                    unsupported: [],
                },
                nanoX: {
                    displayName: 'Ledger Nano X',
                    minimum: '2.0.0',
                    recommended: '2.2.3',
                    knownVulnerable: [],
                    unsupported: [],
                },
                stax: {
                    displayName: 'Ledger Stax',
                    minimum: '1.0.0',
                    recommended: '1.3.0',
                    knownVulnerable: [],
                    unsupported: [],
                },
            },
        },
    },
};
