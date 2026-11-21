// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

@main
struct QRModulesCheck {
    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("failed: \(name)\n".utf8))
        exit(1)
    }

    private static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else { fail(name) }
    }

    static func main() {
        check(
            QRModules.unpack(size: 3, bits: "qoA=") == [
                true, false, true,
                false, true, false,
                true, false, true,
            ],
            "size 3 packModules vector"
        )

        check(
            QRModules.unpack(size: 4, bits: "8JY=") == [
                true, true, true, true,
                false, false, false, false,
                true, false, false, true,
                false, true, true, false,
            ],
            "size 4 packModules vector"
        )

        check(QRModules.unpack(size: 3, bits: "not base64") == nil, "invalid base64")
        check(QRModules.unpack(size: 3, bits: "qg==") == nil, "wrong byte count")
        check(QRModules.unpack(size: 0, bits: "") == nil, "size 0")

        print("QRModulesCheck: 5 passed")
    }
}
