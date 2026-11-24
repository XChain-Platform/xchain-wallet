// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

@main
struct ActivityCheckConfigCheck {
    static func main() {
        let first = ActivityCheckConfig.Target(
            address: "xch1first",
            url: "https://explorer.example/address/xch1first",
            confirmedPath: "balances.confirmed",
            pendingPath: "balances.pending",
            confirmed: "0.5",
            pending: "0"
        )
        let second = ActivityCheckConfig.Target(
            address: "xch1second",
            url: "https://explorer.example/address/xch1second",
            confirmedPath: "balances.confirmed",
            pendingPath: "balances.pending",
            confirmed: nil,
            pending: nil
        )
        let emittedConfig = #"""
        {
          "enabled": true,
          "targets": [
            {
              "address": "xch1first",
              "url": "https://explorer.example/address/xch1first",
              "confirmedPath": "balances.confirmed",
              "pendingPath": "balances.pending",
              "confirmed": "0.5",
              "pending": "0"
            },
            {
              "address": "xch1second",
              "url": "https://explorer.example/address/xch1second",
              "confirmedPath": "balances.confirmed",
              "pendingPath": "balances.pending"
            }
          ],
          "notice": {
            "title": "New activity",
            "body": "Your balances changed"
          },
          "openOnPhoneTitle": "Open on phone"
        }
        """#
        let decoded = ActivityCheckConfig.decode(emittedConfig)

        check(
            "producer shape decodes every field",
            decoded == ActivityCheckConfig(
                enabled: true,
                targets: [first, second],
                noticeTitle: "New activity",
                noticeBody: "Your balances changed",
                openOnPhoneTitle: "Open on phone"
            )
        )
        check("producer shape is runnable", decoded?.isRunnable == true)
        check("addresses stay in order", decoded?.addresses == ["xch1first", "xch1second"])

        let disabled = ActivityCheckConfig.decode(config(enabled: "false"))
        check("disabled config decodes", disabled != nil)
        check("disabled config is not runnable", disabled?.isRunnable == false)

        for (name, enabled) in [
            ("numeric enabled", "1"),
            ("string enabled", #""true""#),
        ] {
            check("\(name) reads false", ActivityCheckConfig.decode(config(enabled: enabled))?.enabled == false)
        }
        check("absent enabled reads false", ActivityCheckConfig.decode(config(enabled: nil))?.enabled == false)
        check(
            "empty targets is not runnable",
            ActivityCheckConfig.decode(#"{"enabled":true,"targets":[]}"#)?.isRunnable == false
        )

        let mixedTargets = #"""
        {
          "enabled": true,
          "targets": [
            {"address": "missing-url", "confirmedPath": "balances.confirmed", "pendingPath": "balances.pending"},
            {
              "address": "",
              "url": "https://empty.example",
              "confirmedPath": "balances.confirmed",
              "pendingPath": "balances.pending"
            },
            {
              "address": "numeric-path",
              "url": "https://numeric.example",
              "confirmedPath": "balances.confirmed",
              "pendingPath": 7
            },
            {
              "address": "valid",
              "url": "https://valid.example",
              "confirmedPath": "balances.confirmed",
              "pendingPath": "balances.pending"
            }
          ]
        }
        """#
        check(
            "invalid targets are dropped beside a valid target",
            ActivityCheckConfig.decode(mixedTargets)?.addresses == ["valid"]
        )

        let numericConfirmed = #"""
        {
          "enabled": true,
          "targets": [{
            "address": "valid",
            "url": "https://valid.example",
            "confirmedPath": "balances.confirmed",
            "pendingPath": "balances.pending",
            "confirmed": 5,
            "pending": "0"
          }]
        }
        """#
        check(
            "numeric confirmed reads nil",
            ActivityCheckConfig.decode(numericConfirmed)?.targets.first?.confirmed == nil
        )
        check(
            "string pending is kept",
            ActivityCheckConfig.decode(numericConfirmed)?.targets.first?.pending == "0"
        )

        let missingNotice = #"{"enabled":true,"targets":[],"openOnPhoneTitle":" \n\t "}"#
        let withoutNotice = ActivityCheckConfig.decode(missingNotice)
        check("whitespace open on phone title reads nil", withoutNotice?.openOnPhoneTitle == nil)
        check("missing notice title reads nil", withoutNotice?.noticeTitle == nil)
        check("missing notice body reads nil", withoutNotice?.noticeBody == nil)

        check("nil input fails", ActivityCheckConfig.decode(nil) == nil)
        check("invalid JSON fails", ActivityCheckConfig.decode("not json") == nil)
        check("top-level array fails", ActivityCheckConfig.decode("[]") == nil)
    }

    private static func config(enabled: String?) -> String {
        let enabledField = enabled.map { #""enabled":\#($0),"# } ?? ""
        return #"""
        {
          \#(enabledField)
          "targets": [{
            "address": "valid",
            "url": "https://valid.example",
            "confirmedPath": "balances.confirmed",
            "pendingPath": "balances.pending"
          }]
        }
        """#
    }

    private static func check(_ name: String, _ passed: @autoclosure () -> Bool) {
        guard passed() else {
            FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
            exit(1)
        }
    }
}
