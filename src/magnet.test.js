import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { decode } from "./magnet.js";

suite("magnet", () => {
    test("decodes valid URI", () => {
        const { infoHash, name } = decode("magnet:?xt=urn:btih:abcd&dn=efgh");
        assert.equal(infoHash, "abcd");
        assert.equal(name, "efgh");
    });

    test("throws decoding URI with an unsupported namespace id", () => {
        assert.throws(() => decode("magnet:?xt=urn:ietf:abcd&dn=efgh"));
    });

    test("throws decoding URI with an invalid namespace id", () => {
        assert.throws(() => decode("magnet:?xt=urn:bti-:abcd&dn=efgh"));
        assert.throws(() => decode("magnet:?xt=urn:-tih:abcd&dn=efgh"));
        assert.throws(() => decode("magnet:?xt=urn:b:abcd&dn=efgh"));
    });
});
