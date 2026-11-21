// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

@main
struct WatchContractBlocksCheck {
    static func main() {
        let decoder = JSONDecoder()

        let rowJson = #"""
        {
          "id": "row-1",
          "chainId": "eip155:1",
          "tick": "ETH",
          "displayName": "Ethereum",
          "amountText": "1.2500",
          "fiatText": "$4,000.00",
          "noPrice": false,
          "pendingText": "0.1000 pending",
          "unavailable": true,
          "iconHash": "abc123",
          "tickerColor": "#627EEA",
          "hasDetail": true
        }
        """#
        guard let row = decode(SnapshotRow.self, from: rowJson, using: decoder),
              row.id == "row-1",
              row.chainId == "eip155:1",
              row.tick == "ETH",
              row.displayName == "Ethereum",
              row.amountText == "1.2500",
              row.fiatText == "$4,000.00",
              row.noPrice == false,
              row.pendingText == "0.1000 pending",
              row.unavailable == true,
              row.iconHash == "abc123",
              row.tickerColor == "#627EEA",
              row.hasDetail == true else {
            fail("full row")
        }

        let receiveJson = #"""
        {
          "chainId": "bip122:000000000019d6689c085ae165831e93",
          "label": "Bitcoin",
          "address": "bc1qexample",
          "qr": { "size": 21, "bits": "AQIDBA==" }
        }
        """#
        guard let receive = decode(SnapshotReceive.self, from: receiveJson, using: decoder),
              receive.chainId == "bip122:000000000019d6689c085ae165831e93",
              receive.label == "Bitcoin",
              receive.address == "bc1qexample",
              exactInt(receive.qr.size) == 21,
              receive.qr.bits == "AQIDBA==" else {
            fail("receive entry")
        }

        let inboxJson = #"""
        {
          "id": "inbox-1",
          "family": "incomingReceipts",
          "kind": "received",
          "title": "Payment received",
          "body": "You received 1.25 ETH",
          "at": 1732147200000,
          "read": false
        }
        """#
        guard let inbox = decode(SnapshotInboxItem.self, from: inboxJson, using: decoder),
              inbox.id == "inbox-1",
              inbox.family == "incomingReceipts",
              inbox.kind == "received",
              inbox.title == "Payment received",
              inbox.body == "You received 1.25 ETH",
              exactInt64(inbox.at) == 1_732_147_200_000,
              inbox.read == false else {
            fail("inbox item")
        }

        let settingsJson = #"""
        { "showTotal": true, "enabled": false }
        """#
        guard let settings = decode(SnapshotSettings.self, from: settingsJson, using: decoder),
              settings.showTotal == true,
              settings.enabled == false else {
            fail("settings block")
        }

        let missingHasDetailJson = #"""
        {
          "id": "row-1",
          "chainId": "eip155:1",
          "tick": "ETH",
          "displayName": "Ethereum",
          "amountText": "1.2500",
          "fiatText": "$4,000.00",
          "noPrice": false,
          "pendingText": "",
          "unavailable": false,
          "iconHash": "abc123",
          "tickerColor": "#627EEA"
        }
        """#
        guard decode(SnapshotRow.self, from: missingHasDetailJson, using: decoder) == nil else {
            fail("row missing hasDetail")
        }

        let stringAtJson = #"""
        {
          "id": "inbox-1",
          "family": "incomingReceipts",
          "kind": "received",
          "title": "Payment received",
          "body": "You received 1.25 ETH",
          "at": "1732147200000",
          "read": false
        }
        """#
        guard decode(SnapshotInboxItem.self, from: stringAtJson, using: decoder) == nil else {
            fail("inbox item with string at")
        }
    }

    private static func decode<Value: Decodable>(
        _ type: Value.Type,
        from json: String,
        using decoder: JSONDecoder
    ) -> Value? {
        try? decoder.decode(type, from: Data(json.utf8))
    }

    private static func exactInt(_ value: Int) -> Int {
        value
    }

    private static func exactInt64(_ value: Int64) -> Int64 {
        value
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAIL: \(name)\n".utf8))
        exit(1)
    }
}
