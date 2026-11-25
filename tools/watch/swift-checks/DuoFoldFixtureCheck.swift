import Foundation

@main
struct DuoFoldFixtureCheck {
    static func main() {
        let repositoryEntries = DuoFoldFixture.load()
        require(repositoryEntries?.count == 6, "repository fixture count")
        require(repositoryEntries?.map(entryName) == DuoFoldPlan.states, "repository fixture state order")
        let repositoryData = try? Data(contentsOf: URL(fileURLWithPath: DuoFoldFixture.relativePath))
        require(repositoryData != nil, "repository fixture read")
        require(repositoryEntries == repositoryData.flatMap(DuoFoldPlan.entries), "repository fixture parse")

        let temporaryRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        require(createDirectory(temporaryRoot), "temporary directory setup")
        defer { try? FileManager.default.removeItem(at: temporaryRoot) }

        let validRoot = temporaryRoot.appendingPathComponent("valid", isDirectory: true)
        guard let validURL = writeFixture(validDocument(), under: validRoot) else {
            fail("valid fixture setup")
        }
        let validSource = validRoot.appendingPathComponent("a/b/c/X.swift").path
        let foundURL = DuoFoldFixture.fixtureURL(sourceFile: validSource)
        require(
            foundURL?.resolvingSymlinksInPath() == validURL.resolvingSymlinksInPath(),
            "nested fixture lookup"
        )
        let validEntries = DuoFoldFixture.load(sourceFile: validSource)
        require(validEntries?.count == 6, "nested fixture load")
        require(DuoFoldFixture.drivable(validEntries ?? []) == ["closed-portrait"], "drivable states")
        require(
            DuoFoldFixture.unreachableNotes(validEntries ?? []) == [
                "closed-landscape: r",
                "open-portrait: r",
                "open-landscape: r",
                "partial-vertical: r",
                "partial-horizontal: r",
            ],
            "unreachable notes"
        )

        let missingRoot = temporaryRoot.appendingPathComponent("missing", isDirectory: true)
        let missingSourceDirectory = missingRoot.appendingPathComponent("a/b/c", isDirectory: true)
        require(createDirectory(missingSourceDirectory), "missing fixture setup")
        let missingSource = missingSourceDirectory.appendingPathComponent("X.swift").path
        require(DuoFoldFixture.fixtureURL(sourceFile: missingSource) == nil, "missing fixture lookup")
        require(DuoFoldFixture.load(sourceFile: missingSource) == nil, "missing fixture load")

        let invalidRoot = temporaryRoot.appendingPathComponent("invalid", isDirectory: true)
        guard writeFixture(Data("not json".utf8), under: invalidRoot) != nil else {
            fail("invalid fixture setup")
        }
        let invalidSource = invalidRoot.appendingPathComponent("X.swift").path
        require(DuoFoldFixture.fixtureURL(sourceFile: invalidSource) != nil, "invalid fixture lookup")
        require(DuoFoldFixture.load(sourceFile: invalidSource) == nil, "invalid fixture refusal")

        let directoryRoot = temporaryRoot.appendingPathComponent("directory", isDirectory: true)
        let directoryFixture = directoryRoot.appendingPathComponent(
            DuoFoldFixture.relativePath,
            isDirectory: true
        )
        require(createDirectory(directoryFixture), "directory fixture setup")
        let directorySource = directoryRoot.appendingPathComponent("X.swift").path
        require(DuoFoldFixture.fixtureURL(sourceFile: directorySource) == nil, "directory fixture refusal")
    }

    private static func entryName(_ entry: DuoFoldPlan.Entry) -> String {
        switch entry {
        case let .measured(name, _, _, _), let .unreachable(name, _):
            return name
        }
    }

    private static func validDocument() -> Data {
        let unreachable = "{\"unreachable\":\"r\"}"
        let states = [
            "\"closed-portrait\":{\"width\":466,\"height\":678,\"division\":"
                + "{\"orientation\":\"none\",\"x\":0,\"y\":0,\"width\":0,\"height\":0}}",
            "\"closed-landscape\":\(unreachable)",
            "\"open-portrait\":\(unreachable)",
            "\"open-landscape\":\(unreachable)",
            "\"partial-vertical\":\(unreachable)",
            "\"partial-horizontal\":\(unreachable)",
        ]
        return Data("{\"states\":{\(states.joined(separator: ","))}}".utf8)
    }

    private static func writeFixture(_ data: Data, under root: URL) -> URL? {
        let fixture = root.appendingPathComponent(DuoFoldFixture.relativePath)
        guard createDirectory(fixture.deletingLastPathComponent()) else {
            return nil
        }
        do {
            try data.write(to: fixture)
            return fixture
        } catch {
            return nil
        }
    }

    private static func createDirectory(_ url: URL) -> Bool {
        do {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            return true
        } catch {
            return false
        }
    }

    private static func require(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("DuoFoldFixtureCheck failed: \(name)\n".utf8))
        exit(1)
    }
}
