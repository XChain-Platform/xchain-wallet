import AppKit
import Foundation

@main
struct AlertFamilyIconCheck {
    private struct Kind: Decodable {
        let icon: String
    }

    private struct InboxSchema: Decodable {
        let items: Items

        struct Items: Decodable {
            let properties: Properties
        }

        struct Properties: Decodable {
            let family: Family
        }

        struct Family: Decodable {
            let values: [String]

            enum CodingKeys: String, CodingKey {
                case values = "enum"
            }
        }
    }

    static func main() {
        let decoder = JSONDecoder()
        let kinds: [String: Kind] = decode(
            [String: Kind].self,
            path: "packages/core/src/watch/contract/kinds.json",
            decoder: decoder
        )
        let inboxSchema: InboxSchema = decode(
            InboxSchema.self,
            path: "packages/core/src/watch/contract/inbox.schema.json",
            decoder: decoder
        )

        for family in kinds.keys.sorted() {
            guard AlertFamilyIcon.phoneIcons[family] == kinds[family]?.icon else {
                fail("phoneIcons does not match kinds.json for family \(family)")
            }
        }

        for family in AlertFamilyIcon.phoneIcons.keys.sorted() where kinds[family] == nil {
            fail("phoneIcons contains family missing from kinds.json: \(family)")
        }

        for family in inboxSchema.items.properties.family.values {
            guard AlertFamilyIcon.phoneIcons[family] != nil else {
                fail("phoneIcons is missing inbox schema family \(family)")
            }
        }

        for phoneIcon in Set(AlertFamilyIcon.phoneIcons.values).sorted() {
            guard AlertFamilyIcon.symbols[phoneIcon] != nil else {
                fail("symbols is missing phone icon \(phoneIcon)")
            }
        }

        let symbols = Set(AlertFamilyIcon.symbols.values).union([AlertFamilyIcon.fallbackSymbol])
        for symbol in symbols.sorted() {
            guard NSImage(systemSymbolName: symbol, accessibilityDescription: nil) != nil else {
                fail("SF Symbol does not resolve: \(symbol)")
            }
        }

        check(AlertFamilyIcon.symbol(family: "request") == "doc.text", "request gives doc.text")
        check(AlertFamilyIcon.symbol(family: "paydue") == "clock", "paydue gives clock")
        check(AlertFamilyIcon.symbol(family: "") == "bell", "empty family gives bell")
        check(AlertFamilyIcon.symbol(family: "TxConfirmations") == "bell", "TxConfirmations gives bell")
        check(AlertFamilyIcon.symbol(family: "unknownFamily") == "bell", "unknownFamily gives bell")
    }

    private static func decode<Value: Decodable>(
        _ type: Value.Type,
        path: String,
        decoder: JSONDecoder
    ) -> Value {
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            return try decoder.decode(type, from: data)
        } catch {
            fail("could not read or decode \(path): \(error)")
        }
    }

    private static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAIL: \(name)\n".utf8))
        exit(1)
    }
}
