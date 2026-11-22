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
        "This wallet is the signer for another phone. It signs transactions built on that phone, but it doesn't have an address for receiving funds. Its wallet mode is shown on Wallet Details and was chosen when the wallet was set up.",
    'receive.chooseAReceiveAddress': 'Choose a Receive Address',
    'receive.generateNewAddress': 'Generate new address',
    'receive.newAddress': 'New',
    'receive.copyQrCode': 'Copy QR code',
    'receive.copyPaymentLink': 'Copy payment link',
    'receive.shareQrPaymentLink': 'Share QR payment link',
    'receive.viewAddressInBlockExplorer': 'View address in block explorer',
    // The action list under the QR: its name and one line per row.
    'receive.qrActions': 'Payment request actions',
    'receive.copyQrCodeDescription': 'The QR image, ready to paste into a message',
    'receive.copyPaymentLinkDescription': 'The address and amount as one link to paste',
    'receive.shareQrPaymentLinkDescription': 'Send the link and QR through another app',
    'receive.viewAddressInBlockExplorerDescription': 'This address and its payments on the explorer',
    'receive.generateNewAddressDescription': 'A fresh address on this network for the next payment',
    'receive.waitingForQr': 'Ready once the QR code appears',
    'receive.generateAnAddressToStart': 'Generate an address to start receiving.',
    'receive.generateAnAddress': 'Generate an Address',
    'receive.addressType': 'Address type',
    'receive.noAddressOfType': 'There is no {addressType} address yet. Create one to receive funds with this address type.',
    'receive.qrCodeFor': 'QR code for {address}',
    'receive.renderingQr': 'Rendering QR…',
    'receive.chooseReceiveAddress': 'Choose receive address',
    'receive.addressHelp': 'The address the payer sends to. Select it to copy it, or use the list button to pick another of your addresses or networks.',
    'receive.assetHelp': 'The coin or token you want to be paid in. It goes into the QR code and payment link with the address.',
    'receive.amountHelp': 'Optional. The amount to ask for: it goes into the QR code and payment link, so the payer\'s wallet fills it in.',
    'receive.verifyThisReceiveAddressOn': 'Verify this receive address on your hardware wallet',
    'receive.copyReceiveAddress': 'Copy Receive Address',
    'receive.your': 'Your',
    // The device name falls back to the lower-case word "device": a sentence keeps
    // it lower case and a Title Case button capitalises it.
    'receive.addressVerifiedOnDevice':
        "✅ Address verified on your {hwDeviceLabel, select, device {device} other {{hwDeviceLabel}}}. It's safe to share.",
    'receive.deviceShowedDifferentAddress':
        "Your {hwDeviceLabel, select, device {device} other {{hwDeviceLabel}}} showed a different address. Don't use this address. Disconnect and re-pair the device.",
    'receive.verifyAddressOnDeviceHint':
        'Verify this address on your {hwDeviceLabel, select, device {device} other {{hwDeviceLabel}}} before sharing it. This protects you if the computer has been compromised.',
    'receive.checkYour': 'Check Your {hwDeviceLabel, select, device {Device} other {{hwDeviceLabel}}}…',
    'receive.verifyOnYour': 'Verify on Your {hwDeviceLabel, select, device {Device} other {{hwDeviceLabel}}}',
    'receive.multisigReceiveAddress': 'Multisig receive address',
    'receive.multisigQrCodeFor': 'Multisig QR code for {address}',
    'receive.renderingMultisigQr': 'Rendering multisig QR…',
    'receive.copyMultisignatureReceiveAddress': 'Copy Multisignature Receive Address',
    'receive.peopleWhoCanSignCosigners': 'People who can sign (cosigners):',
    'receive.receivePayment': 'Receive payment',
};

addEnglish(messages);

export default messages;
