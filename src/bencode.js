import { Buffer } from "node:buffer";
import { isDeepStrictEqual } from "node:util";

export function decode(buffer, strict = true) {
    return decodeImpl(buffer, 0, strict)[0];
}

function decodeImpl(buffer, offset, strict) {
    const type = String.fromCharCode(buffer[offset]);
    if (type === "l") {
        return decodeList(buffer, offset);
    } else if ("0" <= type && type <= "9") {
        return decodeByteString(buffer, offset);
    } else if (type === "d") {
        return decodeDictionary(buffer, offset, strict);
    } else if (type === "i") {
        return decodeInteger(buffer, offset);
    } else {
        throw new Error(`Decode error: invalid data type ${type}`);
    }
}

function decodeList(buffer, offset) {
    const list = [];
    let i = offset + 1;
    while (buffer[i] !== "e".charCodeAt(0)) {
        const [value, end] = decodeImpl(buffer, i);
        list.push(value);
        i = end;
    }
    return [list, i + 1];
}

function decodeByteString(buffer, offset) {
    const colon = buffer.indexOf(":", offset);
    if (colon === -1) {
        throw new Error("Decode error: ':' wasn't found");
    }
    const string = buffer.toString("utf8", offset, colon);
    const n = Number.parseInt(string, 10);
    return [buffer.subarray(colon + 1, colon + 1 + n), colon + 1 + n];
}

function decodeDictionary(buffer, offset, strict) {
    const dictionary = {};
    const keys = [];
    let i = offset + 1;
    while (buffer[i] !== "e".charCodeAt(0)) {
        let [key, keyEnd] = decodeByteString(buffer, i);
        i = keyEnd;
        const [value, valueEnd] = decodeImpl(buffer, i);
        key = key.toString();
        dictionary[key] = value;
        keys.push(key);
        i = valueEnd;
    }
    if (!isDeepStrictEqual(keys, keys.toSorted())) {
        const errorMessage = "Decode error: dictionary keys aren't sorted";

        if (strict) {
            throw new Error(errorMessage);
        } else {
            console.error(errorMessage);
        }
    }
    return [dictionary, i + 1];
}

function decodeInteger(buffer, offset) {
    const end = buffer.indexOf("e", offset);
    if (end === -1) {
        throw new Error("Decode error: 'e' wasn't found");
    }
    const string = buffer.toString("utf8", offset + 1, end);
    const n = Number.parseInt(string, 10);
    if (Object.is(n, -0)) {
        throw new Error("Decode error: integers can't be -0");
    }
    let leadingZeros = 0;
    for (let i = 0; string[i] === "0" && i < string.length; ++i) {
        ++leadingZeros;
    }
    if (leadingZeros > 1) {
        throw new Error("Decode error: integers can't have leading zeros");
    }
    return [n, end + 1];
}

export function encode(value) {
    const type = typeof value;
    if (Array.isArray(value)) {
        return encodeList(value);
    } else if (Buffer.isBuffer(value)) {
        return encodeByteString(value);
    } else if (type === "object") {
        return encodeDictionary(value);
    } else if (type === "number") {
        return encodeInteger(value);
    } else {
        throw new Error(`Encode error: invalid data type ${type}`);
    }
}

function encodeList(array) {
    return Buffer.concat([
        Buffer.from("l"),
        ...array.map((value) => encode(value)),
        Buffer.from("e"),
    ]);
}

function encodeByteString(buffer) {
    return Buffer.concat([
        Buffer.from(buffer.length.toString()),
        Buffer.from(":"),
        buffer,
    ]);
}

function encodeDictionary(object) {
    const pairs = [...Object.entries(object)]
        .sort((a, b) => {
            if (a[0] < b[0]) {
                return -1;
            } else if (a[0] > b[0]) {
                return 1;
            } else {
                return 0;
            }
        })
        .map((pair) => {
            const [key, value] = pair;
            if (typeof key === "symbol") {
                throw new Error("Encode error: keys can't be symbols");
            }
            return Buffer.concat([
                encodeByteString(Buffer.from(key)),
                encode(value),
            ]);
        });
    return Buffer.concat([Buffer.from("d"), ...pairs, Buffer.from("e")]);
}

function encodeInteger(integer) {
    if (!Number.isSafeInteger(integer)) {
        throw new Error("Encode error: not an integer");
    }
    const string = integer.toString();
    return Buffer.concat([
        Buffer.from("i"),
        Buffer.from(string),
        Buffer.from("e"),
    ]);
}
