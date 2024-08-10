import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { suite, test } from "node:test";
import { decode, encode } from "./bencode.js";

suite("bencode", () => {
    suite("lists", () => {
        test("decodes 'l1:a1:b1:ce' to become ['a', 'b', 'c']", () => {
            assert.deepEqual(decode(Buffer.from("l1:a1:b1:ce")), [
                Buffer.from("a"),
                Buffer.from("b"),
                Buffer.from("c"),
            ]);
        });

        test("encodes ['a', 'b', 'c'] to become 'l1:a1:b1:ce'", () => {
            assert.deepEqual(
                encode([Buffer.from("a"), Buffer.from("b"), Buffer.from("c")]),
                Buffer.from("l1:a1:b1:ce")
            );
        });

        test("decodes 'ld1:ai0eed1:bi1eee' to become [{ a: 0 }, { b: 1 }]", () => {
            assert.deepEqual(decode(Buffer.from("ld1:ai0eed1:bi1eee")), [
                { a: 0 },
                { b: 1 },
            ]);
        });

        test("encodes [{ a: 0 }, { b: 1 }] to become 'ld1:ai0eed1:bi1eee'", () => {
            assert.deepEqual(
                encode([{ a: 0 }, { b: 1 }]),
                Buffer.from("ld1:ai0eed1:bi1eee")
            );
        });

        test("decodes 'li0ei1ei2ee' to become [0, 1, 2]", () => {
            assert.deepEqual(decode(Buffer.from("li0ei1ei2ee")), [0, 1, 2]);
        });

        test("encodes [0, 1, 2] to become 'li0ei1ei2ee'", () => {
            assert.deepEqual(encode([0, 1, 2]), Buffer.from("li0ei1ei2ee"));
        });

        test("decodes 'lli0ei1eeli2ei3eee' to become [[0, 1], [2, 3]]", () => {
            assert.deepEqual(decode(Buffer.from("lli0ei1eeli2ei3eee")), [
                [0, 1],
                [2, 3],
            ]);
        });

        test("encodes [[0, 1], [2, 3]] to become 'lli0ei1eeli2ei3eee'", () => {
            assert.deepEqual(
                encode([
                    [0, 1],
                    [2, 3],
                ]),
                Buffer.from("lli0ei1eeli2ei3eee")
            );
        });
    });

    suite("byte strings", () => {
        test("decodes '0:' to become ''", () => {
            assert.deepEqual(decode(Buffer.from("0:")), Buffer.from(""));
        });

        test("encodes '' to become '0:'", () => {
            assert.deepEqual(encode(Buffer.from("")), Buffer.from("0:"));
        });

        test("decodes '3:abc' to become 'abc'", () => {
            assert.deepEqual(decode(Buffer.from("3:abc")), Buffer.from("abc"));
        });

        test("encodes 'abc' to become '3:abc'", () => {
            assert.deepEqual(encode(Buffer.from("abc")), Buffer.from("3:abc"));
        });
    });

    suite("dictionaries", () => {
        test("decodes 'd1:a1:ae' to become { a: 'a' }", () => {
            assert.deepEqual(decode(Buffer.from("d1:a1:ae")), {
                a: Buffer.from("a"),
            });
        });

        test("encodes { a: 'a' } to become 'd1:a1:ae'", () => {
            assert.deepEqual(
                encode({ a: Buffer.from("a") }),
                Buffer.from("d1:a1:ae")
            );
        });

        test("decodes 'd1:ad1:bi0eee' to become { a: { b: 0 } }", () => {
            assert.deepEqual(decode(Buffer.from("d1:ad1:bi0eee")), {
                a: { b: 0 },
            });
        });

        test("encodes { a: { b: 0 } } to become 'd1:ad1:bi0eee'", () => {
            assert.deepEqual(
                encode({ a: { b: 0 } }),
                Buffer.from("d1:ad1:bi0eee")
            );
        });

        test("decodes 'd1:ai0ee' to become { a: 0 }", () => {
            assert.deepEqual(decode(Buffer.from("d1:ai0ee")), { a: 0 });
        });

        test("encodes { a: 0 } to become 'd1:ai0ee'", () => {
            assert.deepEqual(encode({ a: 0 }), Buffer.from("d1:ai0ee"));
        });

        test("decodes 'd1:ali0ei1eee' to become { a: [0, 1] }", () => {
            assert.deepEqual(decode(Buffer.from("d1:ali0ei1eee")), {
                a: [0, 1],
            });
        });

        test("encodes { a: [0, 1] } to become 'd1:ali0ei1eee'", () => {
            assert.deepEqual(
                encode({ a: [0, 1] }),
                Buffer.from("d1:ali0ei1eee")
            );
        });

        test("throws decoding unsorted dictionary 'd1:b1:b1:a1:ae'", () => {
            assert.throws(() => decode(Buffer.from("d1:b1:b1:a1:ae")));
        });
    });

    suite("integers", () => {
        test("decodes 'i-123e' to become -123", () => {
            assert.equal(decode(Buffer.from("i-123e")), -123);
        });

        test("encodes -123 to become 'i-123e'", () => {
            assert.deepEqual(encode(-123), Buffer.from("i-123e"));
        });

        test("throws decoding 'i-0e'", () => {
            assert.throws(() => decode(Buffer.from("i-0e")));
        });

        test("decodes 'i0e' to become 0", () => {
            assert.equal(decode(Buffer.from("i0e")), 0);
        });

        test("encodes 0 to become 'i0e'", () => {
            assert.deepEqual(encode(0), Buffer.from("i0e"));
        });

        test("throws decoding 'i00e'", () => {
            assert.throws(() => decode(Buffer.from("i00e")));
        });

        test("decodes 'i123e' to become 123", () => {
            assert.equal(decode(Buffer.from("i123e")), 123);
        });

        test("encodes 123 to become 'i123e'", () => {
            assert.deepEqual(encode(123), Buffer.from("i123e"));
        });
    });
});
