export function decode(uri) {
    if (!uri.startsWith("magnet:")) {
        throw new Error("Invalid magnet URI");
    }

    uri = uri.slice("magnet:".length);

    const {
        dn: name,
        tr: announce,
        xl: length,
        xt,
    } = Object.fromEntries(new URLSearchParams(uri));

    const [scheme, namespaceID, infoHash] = xt.split(":");

    if (scheme.toLowerCase() !== "urn") {
        throw new Error(`Parse error: scheme ${scheme} is not supported`);
    }

    const invalidNamespaceID = new Error(
        `Parse error: namespace id ${namespaceID} is invalid`
    );

    if (namespaceID.length < 2 || namespaceID.length > 32) {
        throw invalidNamespaceID;
    }

    for (const c of namespaceID) {
        if (!((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "-")) {
            throw invalidNamespaceID;
        }
    }

    if (namespaceID[0] === "-" || namespaceID[namespaceID.length - 1] === "-") {
        throw invalidNamespaceID;
    }

    if (namespaceID !== "btih") {
        throw new Error(
            `Parse error: namespace ${namespaceID} is not supported`
        );
    }

    if (infoHash === undefined) {
        throw new Error("Parse error: info hash is empty");
    }

    return { announce, infoHash, length, name };
}
