// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

@main
struct ReceivePagesCheck {
    static func main() {
        checkFixtures()
        checkInlinePages()
        checkEmptyPages()
        checkClamping()
        checkEmptyString()
    }

    private static func checkFixtures() {
        let fixtureDirectory = URL(fileURLWithPath: "test/fixtures/watch", isDirectory: true)
        let names: [String]
        do {
            names = try FileManager.default.contentsOfDirectory(atPath: fixtureDirectory.path)
                .filter { $0.hasPrefix("snapshot-") && $0.hasSuffix(".json") }
                .sorted()
        } catch {
            fail("list snapshot fixtures: \(error)")
        }
        require(!names.isEmpty, "snapshot fixtures exist")

        let decoder = JSONDecoder()
        for name in names {
            let receive: [SnapshotReceive]
            do {
                let data = try Data(contentsOf: fixtureDirectory.appendingPathComponent(name))
                guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let receiveObject = object["receive"] else {
                    fail("\(name) contains receive")
                }
                let receiveData = try JSONSerialization.data(withJSONObject: receiveObject)
                receive = try decoder.decode([SnapshotReceive].self, from: receiveData)
            } catch {
                fail("\(name) decodes receive: \(error)")
            }

            let pages = ReceivePages.pages(receive)
            require(
                Set(pages.map(\.chainId)).count == pages.count,
                "\(name) pages have distinct chainId"
            )
            require(
                pages.allSatisfy {
                    !$0.chainId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        && !$0.address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                },
                "\(name) pages have nonempty chainId and address"
            )
            if receive.isEmpty {
                require(pages.isEmpty, "\(name) empty receive has no page")
                require(
                    ReceivePages.noticeKey(pages) == ReceivePages.emptyKey,
                    "\(name) empty receive uses w6.empty"
                )
            }
        }
    }

    private static func checkInlinePages() {
        let bitcoin = entry(chainId: "bitcoin", address: "bc1qfirst")
        let ethereum = entry(chainId: "ethereum", address: "0xsecond")
        let solana = entry(chainId: "solana", address: "third")
        let ordered = ReceivePages.pages([bitcoin, ethereum, solana])
        require(
            ordered.map(\.chainId) == ["bitcoin", "ethereum", "solana"],
            "three chains keep snapshot order"
        )
        require(ReceivePages.noticeKey([bitcoin]) == nil, "one page has no notice")

        let preservedAddress = "  0xgrouped address  "
        let filtered = ReceivePages.pages([
            entry(chainId: "kept", address: preservedAddress),
            entry(chainId: "empty-address", address: ""),
            entry(chainId: "space-address", address: " \t\n "),
            entry(chainId: "", address: "missing-chain"),
            entry(chainId: " \t\n ", address: "space-chain"),
            entry(chainId: "kept", address: "later-duplicate"),
            entry(chainId: "recoverable", address: ""),
            entry(chainId: "recoverable", address: "valid-after-invalid")
        ])
        require(filtered.count == 2, "invalid and duplicate entries are dropped")
        require(filtered.first?.chainId == "kept", "first repeated chain is kept")
        require(filtered.first?.address == preservedAddress, "address text is preserved")
        require(filtered.last?.chainId == "recoverable", "invalid entry does not reserve chainId")
    }

    private static func checkEmptyPages() {
        let nilPages = ReceivePages.pages(nil)
        require(nilPages.isEmpty, "nil receive has no page")
        require(ReceivePages.noticeKey(nilPages) == ReceivePages.emptyKey, "nil receive uses w6.empty")

        let emptyPages = ReceivePages.pages([])
        require(emptyPages.isEmpty, "empty receive has no page")
        require(ReceivePages.noticeKey(emptyPages) == ReceivePages.emptyKey, "empty receive uses w6.empty")
    }

    private static func checkClamping() {
        require(ReceivePages.clampedPage(-1, count: 3) == 0, "negative page clamps to zero")
        require(ReceivePages.clampedPage(0, count: 3) == 0, "first page stays zero")
        require(ReceivePages.clampedPage(2, count: 3) == 2, "last page stays in range")
        require(ReceivePages.clampedPage(5, count: 3) == 2, "high page clamps to last")
        require(ReceivePages.clampedPage(-1, count: 0) == 0, "negative page with zero count is zero")
        require(ReceivePages.clampedPage(5, count: 0) == 0, "high page with zero count is zero")
        require(ReceivePages.clampedPage(1, count: -2) == 0, "negative count is zero")
    }

    private static func checkEmptyString() {
        let path = "packages/core/src/watch/contract/strings-balances.json"
        let strings: [String: String]
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            strings = try JSONDecoder().decode([String: String].self, from: data)
        } catch {
            fail("decode strings-balances.json: \(error)")
        }
        require(strings[ReceivePages.emptyKey] != nil, "w6.empty is a balances string key")
    }

    private static func entry(chainId: String, address: String) -> SnapshotReceive {
        SnapshotReceive(
            chainId: chainId,
            label: chainId,
            address: address,
            qr: SnapshotQr(size: 1, bits: "AA==")
        )
    }

    private static func require(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else { fail(name) }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
