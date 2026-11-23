/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Foundation

@main
struct CallbackAddressRuleCheck {

    private static var passed = 0

    static func main() {
        refused("IPv4 0/8 first", v4(0, 0, 0, 0))
        refused("IPv4 0/8 last", v4(0, 255, 255, 255))
        allowed("IPv4 0/8 upper neighbour", v4(1, 0, 0, 0))

        refused("IPv4 10/8 first", v4(10, 0, 0, 0))
        refused("IPv4 10/8 last", v4(10, 255, 255, 255))
        allowed("IPv4 10/8 lower neighbour", v4(9, 255, 255, 255))
        allowed("IPv4 10/8 upper neighbour", v4(11, 0, 0, 0))

        refused("IPv4 100.64/10 first", v4(100, 64, 0, 0))
        refused("IPv4 100.64/10 last", v4(100, 127, 255, 255))
        allowed("IPv4 100.64/10 lower neighbour", v4(100, 63, 255, 255))
        allowed("IPv4 100.64/10 upper neighbour", v4(100, 128, 0, 0))

        refused("IPv4 127/8 first", v4(127, 0, 0, 0))
        refused("IPv4 127/8 last", v4(127, 255, 255, 255))
        allowed("IPv4 127/8 lower neighbour", v4(126, 255, 255, 255))
        allowed("IPv4 127/8 upper neighbour", v4(128, 0, 0, 0))

        refused("IPv4 169.254/16 first", v4(169, 254, 0, 0))
        refused("IPv4 169.254/16 last", v4(169, 254, 255, 255))
        allowed("IPv4 169.254/16 lower neighbour", v4(169, 253, 255, 255))
        allowed("IPv4 169.254/16 upper neighbour", v4(169, 255, 0, 0))

        refused("IPv4 172.16/12 first", v4(172, 16, 0, 0))
        refused("IPv4 172.16/12 last", v4(172, 31, 255, 255))
        allowed("IPv4 172.16/12 lower neighbour", v4(172, 15, 255, 255))
        allowed("IPv4 172.16/12 upper neighbour", v4(172, 32, 0, 0))

        refused("IPv4 192.0.0/24 first", v4(192, 0, 0, 0))
        refused("IPv4 192.0.0/24 last", v4(192, 0, 0, 255))
        allowed("IPv4 192.0.0/24 lower neighbour", v4(191, 255, 255, 255))
        allowed("IPv4 192.0.0/24 upper neighbour", v4(192, 0, 1, 0))

        refused("IPv4 192.168/16 first", v4(192, 168, 0, 0))
        refused("IPv4 192.168/16 last", v4(192, 168, 255, 255))
        allowed("IPv4 192.168/16 lower neighbour", v4(192, 167, 255, 255))
        allowed("IPv4 192.168/16 upper neighbour", v4(192, 169, 0, 0))

        refused("IPv4 198.18/15 first", v4(198, 18, 0, 0))
        refused("IPv4 198.18/15 last", v4(198, 19, 255, 255))
        allowed("IPv4 198.18/15 lower neighbour", v4(198, 17, 255, 255))
        allowed("IPv4 198.18/15 upper neighbour", v4(198, 20, 0, 0))

        refused("IPv4 224/4 first", v4(224, 0, 0, 0))
        refused("IPv4 224/4 last", v4(239, 255, 255, 255))
        allowed("IPv4 224/4 lower neighbour", v4(223, 255, 255, 255))
        refused("IPv4 224/4 upper neighbour", v4(240, 0, 0, 0))
        refused("IPv4 240/4 first", v4(240, 0, 0, 0))
        refused("IPv4 240/4 last", v4(255, 255, 255, 255))
        refused("IPv4 240/4 lower neighbour", v4(239, 255, 255, 255))

        allowed("IPv4 public", v4(8, 8, 8, 8))

        refused("IPv6 unspecified", v6(0, 0, 0, 0, 0, 0, 0, 0))
        refused("IPv6 unspecified upper neighbour", v6(0, 0, 0, 0, 0, 0, 0, 1))
        refused("IPv6 loopback", v6(0, 0, 0, 0, 0, 0, 0, 1))
        refused("IPv6 loopback lower neighbour", v6(0, 0, 0, 0, 0, 0, 0, 0))
        refused("IPv6 loopback upper neighbour", v6(0, 0, 0, 0, 0, 0, 0, 2))

        refused("IPv6 unique-local first", v6(0xfc00, 0, 0, 0, 0, 0, 0, 0))
        refused("IPv6 unique-local last", v6(0xfdff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff))
        allowed("IPv6 unique-local lower neighbour", v6(0xfbff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff))
        allowed("IPv6 unique-local upper neighbour", v6(0xfe00, 0, 0, 0, 0, 0, 0, 0))

        refused("IPv6 link-local first", v6(0xfe80, 0, 0, 0, 0, 0, 0, 0))
        refused("IPv6 link-local last", v6(0xfebf, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff))
        allowed("IPv6 link-local lower neighbour", v6(0xfe7f, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff))
        allowed("IPv6 link-local upper neighbour", v6(0xfec0, 0, 0, 0, 0, 0, 0, 0))

        refused("IPv6 multicast first", v6(0xff00, 0, 0, 0, 0, 0, 0, 0))
        refused("IPv6 multicast last", v6(0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff))
        allowed("IPv6 multicast lower neighbour", v6(0xfeff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff))

        allowed("IPv6 public", v6(0x2001, 0x4860, 0x4860, 0, 0, 0, 0, 0x8888))
        refused("IPv4-mapped first", v6(0, 0, 0, 0, 0, 0xffff, 0, 0))
        refused("IPv4-mapped last", v6(0, 0, 0, 0, 0, 0xffff, 0xffff, 0xffff))
        allowed("IPv4-mapped lower neighbour", v6(0, 0, 0, 0, 0, 0xfffe, 0xffff, 0xffff))
        allowed("IPv4-mapped upper neighbour", v6(0, 0, 0, 0, 1, 0, 0, 0))
        refused("IPv4-mapped public", v6(0, 0, 0, 0, 0, 0xffff, 0x0808, 0x0808))
        refused("IPv4-compatible first", v6(0, 0, 0, 0, 0, 0, 0, 0))
        refused("IPv4-compatible last", v6(0, 0, 0, 0, 0, 0, 0xffff, 0xffff))
        allowed("IPv4-compatible upper neighbour", v6(0, 0, 0, 0, 0, 1, 0, 0))
        refused("IPv4-compatible public", v6(0, 0, 0, 0, 0, 0, 0x0808, 0x0808))

        refused("nil address", nil)
        refused("empty address", [])
        refused("5-byte address", Array(repeating: 0, count: 5))
        refused("15-byte address", Array(repeating: 0, count: 15))

        allowedInDeveloperMode("Developer Mode 127 first", v4(127, 0, 0, 1))
        allowedInDeveloperMode("Developer Mode 127 last", v4(127, 255, 255, 255))
        allowedInDeveloperMode("Developer Mode IPv6 loopback", v6(0, 0, 0, 0, 0, 0, 0, 1))
        refusedInDeveloperMode("Developer Mode private IPv4", v4(10, 0, 0, 1))
        refusedInDeveloperMode("Developer Mode mapped loopback", v6(0, 0, 0, 0, 0, 0xffff, 0x7f00, 1))

        check("refusesAny nil list", CallbackAddressRule.refusesAny(nil, developerMode: false))
        check("refusesAny empty list", CallbackAddressRule.refusesAny([], developerMode: false))
        check("refusesAny public-only list", !CallbackAddressRule.refusesAny([
            v4(8, 8, 8, 8),
            v6(0x2001, 0x4860, 0x4860, 0, 0, 0, 0, 0x8888)
        ], developerMode: false))
        check("refusesAny mixed list", CallbackAddressRule.refusesAny([
            v4(8, 8, 8, 8),
            v4(10, 0, 0, 1)
        ], developerMode: false))

        print("CallbackAddressRuleCheck: \(passed) passed, 0 failed")
    }

    private static func refused(_ name: String, _ address: [UInt8]?) {
        check(name, CallbackAddressRule.isRefused(address, developerMode: false))
    }

    private static func allowed(_ name: String, _ address: [UInt8]) {
        check(name, !CallbackAddressRule.isRefused(address, developerMode: false))
    }

    private static func refusedInDeveloperMode(_ name: String, _ address: [UInt8]) {
        check(name, CallbackAddressRule.isRefused(address, developerMode: true))
    }

    private static func allowedInDeveloperMode(_ name: String, _ address: [UInt8]) {
        check(name, !CallbackAddressRule.isRefused(address, developerMode: true))
    }

    private static func check(_ name: String, _ condition: Bool) {
        guard condition else {
            FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
            exit(1)
        }
        passed += 1
    }

    private static func v4(_ first: UInt8, _ second: UInt8, _ third: UInt8, _ fourth: UInt8) -> [UInt8] {
        [first, second, third, fourth]
    }

    private static func v6(_ hextets: UInt16...) -> [UInt8] {
        precondition(hextets.count == 8, "IPv6 requires 8 hextets")
        return hextets.flatMap { [UInt8($0 >> 8), UInt8($0 & 0xff)] }
    }
}
