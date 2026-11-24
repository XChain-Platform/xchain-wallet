import Foundation
import CryptoKit

@main
enum WatchPluginArgsCheck {
    private static var passed = 0

    static func main() {
        checkSnapshotFixtures()
        checkDetailFixtures()
        checkSharedRefusals()
        checkDetailRefusals()

        print("PASS: \(passed) checks")
    }

    private static func checkSnapshotFixtures() {
        for path in fixturePaths(prefix: "snapshot-") {
            let data = fixtureData(path)
            let json = fixtureString(data, path: path)
            let expected = fixtureObject(data, path: path)

            check("\(path) snapshot context") {
                guard let context = WatchPluginArgs.snapshotContext(json: json),
                      let version = context["v"] as? NSNumber else {
                    return false
                }

                return version.compare(NSNumber(value: 1)) == .orderedSame
                    && Set(context.keys) == Set(expected.keys)
            }
        }
    }

    private static func checkDetailFixtures() {
        for path in fixturePaths(prefix: "detail-") {
            let data = fixtureData(path)
            let json = fixtureString(data, path: path)
            let expected = fixtureObject(data, path: path)
            guard let tokenId = expected["tokenId"] as? String else {
                fail("\(path) fixture tokenId")
            }
            let expectedHash = SHA256.hash(data: data)
                .map { String(format: "%02x", $0) }
                .joined()

            check("\(path) detail file") {
                guard let detail = WatchPluginArgs.detailFile(json: json) else {
                    return false
                }

                return detail.tokenId == tokenId
                    && detail.data == data
                    && detail.hash == expectedHash
            }
        }
    }

    private static func checkSharedRefusals() {
        let cases: [(name: String, json: String?)] = [
            ("nil", nil),
            ("empty string", ""),
            ("JSON array", "[{\"v\":1}]"),
            ("v 2", "{\"v\":2,\"tokenId\":\"token\"}"),
            ("v true", "{\"v\":true,\"tokenId\":\"token\"}"),
            ("missing v", "{\"tokenId\":\"token\"}"),
            ("nested null", "{\"v\":1,\"tokenId\":\"token\",\"outer\":{\"inner\":null}}"),
        ]

        for testCase in cases {
            check("snapshot rejects \(testCase.name)") {
                WatchPluginArgs.snapshotContext(json: testCase.json) == nil
            }
            check("detail rejects \(testCase.name)") {
                WatchPluginArgs.detailFile(json: testCase.json) == nil
            }
        }
    }

    private static func checkDetailRefusals() {
        let cases = [
            ("missing tokenId", "{\"v\":1}"),
            ("empty tokenId", "{\"v\":1,\"tokenId\":\"\"}"),
            ("numeric tokenId", "{\"v\":1,\"tokenId\":1}"),
        ]

        for testCase in cases {
            check("detail rejects \(testCase.0)") {
                WatchPluginArgs.detailFile(json: testCase.1) == nil
            }
        }
    }

    private static func fixturePaths(prefix: String) -> [String] {
        let directory = "test/fixtures/watch"

        do {
            return try FileManager.default.contentsOfDirectory(atPath: directory)
                .filter { $0.hasPrefix(prefix) && $0.hasSuffix(".json") }
                .sorted()
                .map { "\(directory)/\($0)" }
        } catch {
            fail("could not list \(directory): \(error)")
        }
    }

    private static func fixtureData(_ path: String) -> Data {
        do {
            return try Data(contentsOf: URL(fileURLWithPath: path))
        } catch {
            fail("could not read \(path): \(error)")
        }
    }

    private static func fixtureString(_ data: Data, path: String) -> String {
        guard let value = String(data: data, encoding: .utf8) else {
            fail("\(path) is not UTF-8")
        }
        return value
    }

    private static func fixtureObject(_ data: Data, path: String) -> [String: Any] {
        do {
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                fail("\(path) is not a JSON object")
            }
            return object
        } catch {
            fail("could not parse \(path): \(error)")
        }
    }

    private static func check(_ name: String, _ condition: () -> Bool) {
        guard condition() else {
            fail(name)
        }
        passed += 1
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
