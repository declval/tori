import { Buffer } from "node:buffer";
import { randomInt } from "node:crypto";
import { createSocket } from "node:dgram";
import { decode, encode } from "./bencode.js";
import config from "./config.js";
import { decodePeers, sendUDPMessage } from "./util.js";

export class Node {
    #socket;

    static port = 6881;

    constructor() {
        this.#socket = createSocket("udp4")
            .on("error", (error) => {
                socket.close();

                console.error(error);
            })
            .on("message", (msg, rinfo) => {
                socket.close();

                console.log(msg, rinfo);
            })
            .bind(Node.port);
        this.peers = [];
    }

    announcePeer(port, address, infoHash, token) {
        return new Promise(async (resolve, reject) => {
            const transactionID = Buffer.alloc(2);

            transactionID.writeUInt16BE(randomInt(2 ** 16));

            const timeout = setTimeout(
                () => reject(new Error("announce_peer timed out")),
                16000
            );

            const msg = await send(
                encode({
                    a: {
                        id: config.nodeID,
                        implied_port: 1,
                        info_hash: infoHash,
                        token,
                    },
                    q: Buffer.from("announce_peer"),
                    t: transactionID,
                    y: Buffer.from("q"),
                }),
                port,
                address
            );

            clearTimeout(timeout);

            const decoded = decode(msg);

            const receivedTransactionID = decoded.t;

            if (!receivedTransactionID.equal(transactionID)) {
                reject(new Error("Transaction id did not match"));
            }

            if (decoded.y.equal(Buffer.from("e"))) {
                const code = decoded.e[0];
                const message = decoded.e[1].toString();

                reject(new Error(`${message} (${code})`));
            }

            if (!decoded.y.equal(Buffer.from("r"))) {
                reject(
                    new Error(`Unexpected message type ${decoded.y.toString()}`)
                );
            }

            resolve(decoded.r.id);
        });
    }

    findNode(port, address, targetNodeID) {
        return new Promise(async (resolve, reject) => {
            const transactionID = Buffer.alloc(2);

            transactionID.writeUInt16BE(randomInt(2 ** 16));

            const timeout = setTimeout(
                () => reject(new Error("find_node timed out")),
                16000
            );

            const msg = await send(
                encode({
                    a: { id: config.nodeID, target: targetNodeID },
                    q: Buffer.from("find_node"),
                    t: transactionID,
                    y: Buffer.from("q"),
                }),
                port,
                address
            );

            clearTimeout(timeout);

            const decoded = decode(msg);

            const receivedTransactionID = decoded.t;

            if (!receivedTransactionID.equal(transactionID)) {
                reject(new Error("Transaction id did not match"));
            }

            if (decoded.y.equal(Buffer.from("e"))) {
                const code = decoded.e[0];
                const message = decoded.e[1].toString();

                reject(new Error(`${message} (${code})`));
            }

            if (!decoded.y.equal(Buffer.from("r"))) {
                reject(
                    new Error(`Unexpected message type ${decoded.y.toString()}`)
                );
            }

            resolve({ id: decoded.r.id, nodes: decodeNodes(decoded.r.nodes) });
        });
    }

    getPeers(port, address, infoHash) {
        return new Promise(async (resolve, reject) => {
            const transactionID = Buffer.alloc(2);

            transactionID.writeUInt16BE(randomInt(2 ** 16));

            const timeout = setTimeout(
                () => reject(new Error("get_peers timed out")),
                16000
            );

            const msg = await send(
                encode({
                    a: { id: config.nodeID, info_hash: infoHash },
                    q: Buffer.from("get_peers"),
                    t: transactionID,
                    y: Buffer.from("q"),
                }),
                port,
                address
            );

            clearTimeout(timeout);

            const decoded = decode(msg);

            const receivedTransactionID = decoded.t;

            if (!receivedTransactionID.equal(transactionID)) {
                reject(new Error("Transaction id did not match"));
            }

            if (decoded.y.equal(Buffer.from("e"))) {
                const code = decoded.e[0];
                const message = decoded.e[1].toString();

                reject(new Error(`${message} (${code})`));
            }

            if (!decoded.y.equal(Buffer.from("r"))) {
                reject(
                    new Error(`Unexpected message type ${decoded.y.toString()}`)
                );
            }

            const result = { id: decoded.r.id, token: decoded.r.token };

            if (decoded.r.nodes !== undefined) {
                result.nodes = decodeNodes(decoded.r.nodes);
            } else {
                result.peers = decodePeers(Buffer.concat(decoded.r.values));
            }

            resolve(result);
        });
    }

    ping(port, address) {
        return new Promise(async (resolve, reject) => {
            const transactionID = Buffer.alloc(2);

            transactionID.writeUInt16BE(randomInt(2 ** 16));

            const timeout = setTimeout(
                () => reject(new Error("ping timed out")),
                16000
            );

            const msg = await send(
                encode({
                    a: { id: config.nodeID },
                    q: Buffer.from("ping"),
                    t: transactionID,
                    y: Buffer.from("q"),
                }),
                port,
                address
            );

            clearTimeout(timeout);

            const decoded = decode(msg);

            const receivedTransactionID = decoded.t;

            if (!receivedTransactionID.equal(transactionID)) {
                reject(new Error("Transaction id did not match"));
            }

            if (decoded.y.equal(Buffer.from("e"))) {
                const code = decoded.e[0];
                const message = decoded.e[1].toString();

                reject(new Error(`${message} (${code})`));
            }

            if (!decoded.y.equal(Buffer.from("r"))) {
                reject(
                    new Error(`Unexpected message type ${decoded.y.toString()}`)
                );
            }

            resolve(decoded.r.id);
        });
    }
}

function decodeNodes(buffer) {
    const nodes = [];

    for (let i = 0; i < buffer.length; i += 26) {
        const node = {};

        node.id = buffer.subarray(i, i + 20);
        node.ip = [...buffer.subarray(i + 20, i + 24)].join(".");
        node.port = buffer.readUInt16BE(i + 24);

        nodes.push(node);
    }

    return nodes;
}

function distance(a, b) {
    let result = 0;

    for (let i = 0; i < a.length; ++i) {
        result += (a[i] ^ b[i]) << (8 * i);
    }

    return result;
}

function send(buffer, port, address) {
    return new Promise(async (resolve, reject) => {
        const socket = createSocket("udp4")
            .on("error", (error) => {
                socket.close();

                reject(error);
            })
            .on("message", (msg) => {
                socket.close();

                resolve(msg);
            });

        socket.send(buffer, port, address);
    });
}
