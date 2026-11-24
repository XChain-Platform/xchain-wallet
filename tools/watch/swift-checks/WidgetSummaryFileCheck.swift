import Foundation

@main
struct WidgetSummaryFileCheck {
    static func main() {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let summaryFile = WidgetSummaryFile(directory: directory)
        require(summaryFile.read() == nil, "read before any write is nil")

        let first = WidgetSummaryContent(
            unreadCount: 2,
            requestWaiting: true,
            totalText: "$42.00",
            balancesAt: 1_700_000_000
        )
        let firstChanged: Bool
        do {
            firstChanged = try summaryFile.write(first)
        } catch {
            fail("first write succeeds: \(error)")
        }
        require(firstChanged, "first write returns true")
        require(
            FileManager.default.fileExists(atPath: directory.path),
            "first write creates the directory"
        )
        require(summaryFile.read() == first, "first write reads back equal")

        let fileURL = directory.appendingPathComponent(WidgetSummaryFile.fileName)
        let bytesBeforeSameWrite: Data
        do {
            bytesBeforeSameWrite = try Data(contentsOf: fileURL)
        } catch {
            fail("read bytes before same-content write: \(error)")
        }

        let sameChanged: Bool
        do {
            sameChanged = try summaryFile.write(first)
        } catch {
            fail("same-content write succeeds: \(error)")
        }
        require(!sameChanged, "same content returns false")
        let bytesAfterSameWrite: Data
        do {
            bytesAfterSameWrite = try Data(contentsOf: fileURL)
        } catch {
            fail("read bytes after same-content write: \(error)")
        }
        require(
            bytesAfterSameWrite == bytesBeforeSameWrite,
            "same content leaves bytes unchanged"
        )

        let changed = WidgetSummaryContent(
            unreadCount: 5,
            requestWaiting: false,
            totalText: nil,
            balancesAt: 1_700_000_001
        )
        let changedResult: Bool
        do {
            changedResult = try summaryFile.write(changed)
        } catch {
            fail("changed-content write succeeds: \(error)")
        }
        require(changedResult, "changed content returns true")
        require(summaryFile.read() == changed, "changed content reads back equal")

        do {
            let data = try Data(contentsOf: fileURL)
            let object = try JSONSerialization.jsonObject(with: data)
            guard let dictionary = object as? [String: Any] else {
                fail("content without a total encodes as an object")
            }
            require(
                dictionary["totalText"] == nil,
                "content without a total writes no totalText key"
            )
        } catch {
            fail("inspect content without a total: \(error)")
        }

        do {
            try Data("not JSON".utf8).write(to: fileURL)
        } catch {
            fail("write invalid JSON fixture: \(error)")
        }
        require(summaryFile.read() == nil, "invalid JSON reads nil")

        let recoveryChanged: Bool
        do {
            recoveryChanged = try summaryFile.write(first)
        } catch {
            fail("write after invalid JSON succeeds: \(error)")
        }
        require(recoveryChanged, "write after invalid JSON returns true")

        let contents: [URL]
        do {
            contents = try FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: nil
            )
        } catch {
            fail("list final directory: \(error)")
        }
        require(
            contents.map(\.lastPathComponent) == [WidgetSummaryFile.fileName],
            "directory holds only widget-summary.json"
        )
    }

    private static func require(_ condition: @autoclosure () -> Bool, _ name: String) {
        if !condition() {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
