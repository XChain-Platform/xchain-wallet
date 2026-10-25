// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `receive.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // Copy moved out of JSX literals by the i18n sweep.
    'receive.thisWalletIsInSigner':
        "This wallet is in signer mode. It can sign transactions from a watch-only wallet, but it doesn't have an address for receiving funds. To receive on this device, change Wallet mode in Settings.",
    'receive.chooseAReceiveAddress': 'Choose a receive address',
    'receive.generateNewAddress': 'Generate new address',
    'receive.newAddress': 'New address',
    'receive.copyQrCode': 'Copy QR code',
    'receive.copyPaymentLink': 'Copy payment link',
    'receive.copyQr': 'Copy QR',
    'receive.shareQrPaymentLink': 'Share QR payment link',
    'receive.shareQr': 'Share QR',
    'receive.viewAddressInBlockExplorer': 'View address in block explorer',
    'receive.generateAnAddressToStart': 'Generate an address to start receiving.',
    'receive.generateAnAddress': 'Generate an address',
    'receive.addressType': 'Address type',
    'receive.thereIsNo': 'There is no',
    'receive.addressYetCreateOneTo': 'address yet. Create one to receive funds with this address type.',
    'receive.qrCodeFor': 'QR code for {address}',
    'receive.renderingQr': 'Rendering QR…',
    'receive.tapToCopyAddress': 'Tap to copy address',
    'receive.tapTheAddressToCopy': 'Tap the address to copy it.',
    'receive.chooseReceiveAddress': 'Choose receive address',
    'receive.addressLabel': 'Address label',
    'receive.addALabel': 'Add a label',
    'receive.saveLabel': 'Save label',
    'receive.changeAssetCurrentlyOn': 'Change asset (currently {selectedTick} on {displayName})',
    'receive.verifyThisReceiveAddressOn': 'Verify this receive address on your hardware wallet',
    'receive.copyReceiveAddress': 'Copy receive address',
    'receive.addressVerifiedOnYour': '✅ Address verified on your',
    'receive.itIsSafeToShare': ". It's safe to share.",
    'receive.your': 'Your',
    'receive.showedADifferentAddressDo':
        "showed a different address. Don't use this address. Disconnect and re-pair the device.",
    'receive.verifyThisAddressOnYour': 'Verify this address on your',
    'receive.beforeSharingItThisProtects':
        'before sharing it. This protects you if the computer has been compromised.',
    'receive.checkYour': 'Check your {hwDeviceLabel}…',
    'receive.verifyOnYour': 'Verify on your {hwDeviceLabel}',
    'receive.multisigReceiveAddress': 'Multisig receive address',
    'receive.multisigQrCodeFor': 'Multisig QR code for {address}',
    'receive.renderingMultisigQr': 'Rendering multisig QR…',
    'receive.copyMultisignatureReceiveAddress': 'Copy multisignature receive address',
    'receive.peopleWhoCanSignCosigners': 'People who can sign (cosigners):',
    'receive.receivePayment': 'Receive payment',
};

addEnglish(messages);

export default messages;
