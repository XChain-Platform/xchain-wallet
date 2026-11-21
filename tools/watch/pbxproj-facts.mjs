function tokenize(text) {
    const tokens = [];
    let index = 0;

    while (index < text.length) {
        const character = text[index];

        if (/\s/.test(character)) {
            index += 1;
            continue;
        }
        if (text.startsWith('//', index)) {
            const end = text.indexOf('\n', index + 2);
            index = end === -1 ? text.length : end + 1;
            continue;
        }
        if (text.startsWith('/*', index)) {
            const end = text.indexOf('*/', index + 2);
            if (end === -1) {
                throw new SyntaxError('Unterminated comment');
            }
            index = end + 2;
            continue;
        }
        if ('{}()=;,'.includes(character)) {
            tokens.push(character);
            index += 1;
            continue;
        }
        if (character === '"') {
            let value = '';
            index += 1;
            while (index < text.length && text[index] !== '"') {
                if (text[index] !== '\\') {
                    value += text[index];
                    index += 1;
                    continue;
                }

                index += 1;
                if (index >= text.length) {
                    throw new SyntaxError('Unterminated quoted string');
                }
                const escaped = text[index];
                value += {
                    n: '\n',
                    r: '\r',
                    t: '\t',
                }[escaped] ?? escaped;
                index += 1;
            }
            if (text[index] !== '"') {
                throw new SyntaxError('Unterminated quoted string');
            }
            tokens.push(value);
            index += 1;
            continue;
        }

        const start = index;
        while (
            index < text.length
            && !/\s/.test(text[index])
            && !'{}()=;,"'.includes(text[index])
            && !text.startsWith('//', index)
            && !text.startsWith('/*', index)
        ) {
            index += 1;
        }
        if (index === start) {
            throw new SyntaxError(`Unexpected character at offset ${index}`);
        }
        tokens.push(text.slice(start, index));
    }

    return tokens;
}

function parsePbxproj(text) {
    const tokens = tokenize(text);
    let index = 0;

    function take(expected) {
        const token = tokens[index];
        if (expected !== undefined && token !== expected) {
            throw new SyntaxError(`Expected ${expected}, received ${token ?? 'end of input'}`);
        }
        index += 1;
        return token;
    }

    function value() {
        if (tokens[index] === '{') {
            return dictionary();
        }
        if (tokens[index] === '(') {
            return array();
        }
        const scalar = take();
        if (scalar === undefined) {
            throw new SyntaxError('Unexpected end of input');
        }
        return scalar;
    }

    function dictionary() {
        const result = {};
        take('{');
        while (tokens[index] !== '}') {
            const key = take();
            if (key === undefined) {
                throw new SyntaxError('Unterminated dictionary');
            }
            take('=');
            result[key] = value();
            take(';');
        }
        take('}');
        return result;
    }

    function array() {
        const result = [];
        take('(');
        while (tokens[index] !== ')') {
            result.push(value());
            if (tokens[index] === ',') {
                take(',');
            }
        }
        take(')');
        return result;
    }

    const result = value();
    if (index !== tokens.length) {
        throw new SyntaxError(`Unexpected token ${tokens[index]}`);
    }
    return result;
}

export function pbxprojFacts(text) {
    const project = parsePbxproj(text);
    const objects = project.objects ?? {};
    const objectsOfType = (type) => Object.values(objects)
        .filter((object) => object.isa === type);
    const numberValue = (value) => value === undefined ? undefined : Number(value);

    const targets = objectsOfType('PBXNativeTarget').map((target) => {
        const configurationList = objects[target.buildConfigurationList];
        const bundleIds = (configurationList?.buildConfigurations ?? [])
            .map((reference) => objects[reference]?.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER)
            .filter((bundleId) => bundleId !== undefined);

        return {
            name: target.name,
            productType: target.productType,
            bundleIds: [...new Set(bundleIds)].sort(),
        };
    }).sort((left, right) => String(left.name).localeCompare(String(right.name)));

    const synchronizedGroups = objectsOfType('PBXFileSystemSynchronizedRootGroup')
        .map((group) => group.path)
        .sort();

    const copyPhases = objectsOfType('PBXCopyFilesBuildPhase').map((phase) => ({
        name: phase.name,
        dstSubfolderSpec: numberValue(phase.dstSubfolderSpec),
        dstPath: phase.dstPath,
    }));

    return {
        objectVersion: numberValue(project.objectVersion),
        preferredProjectObjectVersion: numberValue(project.preferredProjectObjectVersion),
        targets,
        synchronizedGroups,
        copyPhases,
    };
}
