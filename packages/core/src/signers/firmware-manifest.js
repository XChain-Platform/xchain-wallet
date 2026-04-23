// Firmware manifest — §18.4. Bundled at build time, consulted by
// `checkFirmware` to verdict a device's reported version.
//
// Schema note: `minimum` is the floor below which the wallet refuses
// to sign; `recommended` is the version the UI nudges users toward.
// `knownVulnerable` / `unsupported` accept exact strings, prefix
// strings ending in ".", or "N.x" major-only patterns (see
// `checkFirmware.js`'s findMatch).
//
// A future enhancement fetches the manifest at runtime so firmware
// advisories can propagate between releases; per §18.4, until that
// lands, the manifest travels with the wallet bundle and is refreshed
// per release.

export const FIRMWARE_MANIFEST = {
    schema: 'firmware-manifest/1',
    generatedAt: '2026-04-23',
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
