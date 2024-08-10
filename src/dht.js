import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomInt } from "node:crypto";
import { createSocket } from "node:dgram";
import { decode, encode } from "./bencode.js";
import config from "./config.js";
import { decodePeers, sendUDPMessage } from "./util.js";

export class Node {
    #buckets;
    #infoHashToPeers;
    #socket;
    #writeToken;

    constructor() {
        this.#buckets = [[]];
        this.#infoHashToPeers = new Map();
        this.#socket = createSocket("udp4")
            .on("error", (error) => {
                console.error(error);
            })
            .on("message", (msg, { address, family, port, size }) => {
                if (config.verbose) {
                    console.log(`DHT query of size ${size} received`);
                }

                if (family !== "IPv4") {
                    if (config.verbose) {
                        console.error(
                            `Address family ${family} is not supported`
                        );

                        return;
                    }
                }

                const decoded = decode(msg);

                if (
                    !Object.hasOwn(decoded, "a") ||
                    !Object.hasOwn(decoded, "q") ||
                    !Object.hasOwn(decoded, "t") ||
                    !Object.hasOwn(decoded, "y")
                ) {
                    console.error("Malformed DHT request");

                    return;
                }

                if (!decoded.y.equals(Buffer.from("q"))) {
                    if (config.verbose) {
                        console.error(
                            `Unexpected value of property 'y': ${decoded.y}`
                        );
                    }

                    return;
                }

                let buffer;

                if (decoded.q.equals(Buffer.from("announce_peer"))) {
                    if (config.verbose) {
                        console.log("Received announce_peer");
                    }

                    if (!decoded.a.token.equals(this.#writeToken)) {
                        if (config.verbose) {
                            console.error("Write token didn't match");
                        }

                        return;
                    }

                    buffer = encode({
                        r: {
                            id: config.nodeID,
                        },
                        t: decoded.t,
                        y: Buffer.from("r"),
                    });
                } else if (decoded.q.equals(Buffer.from("find_node"))) {
                    if (config.verbose) {
                        console.log("Received find_node");
                    }

                    // buffer = encode({
                    //     r: {
                    //         id: config.nodeID,
                    //         nodes: /* TODO */ Buffer.from(""),
                    //     },
                    //     t: decoded.t,
                    //     y: Buffer.from("r"),
                    // });
                } else if (decoded.q.equals(Buffer.from("get_peers"))) {
                    if (config.verbose) {
                        console.log("Received get_peers");
                    }

                    // buffer = encode({
                    //     r: {
                    //         id: config.nodeID,
                    //         nodes: /* TODO */ Buffer.from(""),
                    //         token: this.#writeToken,
                    //         values: /* TODO */ [Buffer.from("")],
                    //     },
                    //     t: decoded.t,
                    //     y: Buffer.from("r"),
                    // });
                } else if (decoded.q.equals(Buffer.from("ping"))) {
                    if (config.verbose) {
                        console.log("Received ping");
                    }

                    buffer = encode({
                        r: {
                            id: config.nodeID,
                        },
                        t: decoded.t,
                        y: Buffer.from("r"),
                    });
                } else {
                    if (config.verbose) {
                        console.error(
                            `Unexpected value of property 'q': ${decoded.q}`
                        );
                    }
                }

                if (buffer !== undefined) {
                    this.#socket.send(buffer, port, address);
                }
            })
            .bind(config.nodePort);
    }

    announcePeer(port, address, infoHash, token) {
        return new Promise(async (resolve, reject) => {
            if (config.verbose) {
                console.log(`announce_peer ${address}:${port}`);
            }

            const transactionID = Buffer.alloc(2);

            transactionID.writeUInt16BE(randomInt(2 ** 16));

            const timeout = setTimeout(
                () => reject(new Error("announce_peer timed out")),
                16000
            );

            const msg = await sendUDPMessage(
                new URL(`udp://${address}:${port}`),
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
                })
            );

            clearTimeout(timeout);

            const decoded = decode(msg);

            const receivedTransactionID = decoded.t;

            if (!receivedTransactionID.equals(transactionID)) {
                reject(new Error("Transaction id did not match"));

                return;
            }

            if (decoded.y.equals(Buffer.from("e"))) {
                const code = decoded.e[0];
                const message = decoded.e[1].toString();

                reject(new Error(`${message} (${code})`));

                return;
            }

            if (!decoded.y.equals(Buffer.from("r"))) {
                reject(
                    new Error(`Unexpected message type ${decoded.y.toString()}`)
                );

                return;
            }

            resolve(decoded.r.id);
        });
    }

    findNode(port, address, targetNodeID) {
        return new Promise(async (resolve, reject) => {
            if (config.verbose) {
                console.log(`find_node ${address}:${port}`);
            }

            const transactionID = Buffer.alloc(2);

            transactionID.writeUInt16BE(randomInt(2 ** 16));

            const timeout = setTimeout(
                () => reject(new Error("find_node timed out")),
                16000
            );

            const msg = await sendUDPMessage(
                new URL(`udp://${address}:${port}`),
                encode({
                    a: { id: config.nodeID, target: targetNodeID },
                    q: Buffer.from("find_node"),
                    t: transactionID,
                    y: Buffer.from("q"),
                })
            );

            clearTimeout(timeout);

            const decoded = decode(msg, false);

            const receivedTransactionID = decoded.t;

            if (!receivedTransactionID.equals(transactionID)) {
                reject(new Error("Transaction id did not match"));

                return;
            }

            if (decoded.y.equals(Buffer.from("e"))) {
                const code = decoded.e[0];
                const message = decoded.e[1].toString();

                reject(new Error(`${message} (${code})`));

                return;
            }

            if (!decoded.y.equals(Buffer.from("r"))) {
                reject(
                    new Error(`Unexpected message type ${decoded.y.toString()}`)
                );

                return;
            }

            resolve({ id: decoded.r.id, nodes: decodeNodes(decoded.r.nodes) });
        });
    }

    async getPeers(port, address, infoHash) {
        if (config.verbose) {
            console.log(`get_peers ${address}:${port}`);
        }

        const peers = [];
        const stack = [];
        const visited = new Set();

        stack.push([port, address]);
        visited.add(address);

        while (stack.length) {
            const [port, address] = stack.pop();

            let result;

            try {
                result = await this.#getPeers(port, address, infoHash);
                console.log(result);
            } catch {
                continue;
            }

            if (result.peers !== undefined) {
                peers.push(...result.peers);

                const ips = new Set(peers.map((peer) => peer.ip));

                if (ips.size >= 10) {
                    break;
                }

                continue;
            }

            if (result.nodes !== undefined) {
                for (const node of result.nodes) {
                    if (!visited.has(node.ip)) {
                        visited.add(node.ip);
                        stack.push([node.port, node.ip]);
                    }
                }
            }
        }

        return peers;
    }

    #getPeers(port, address, infoHash) {
        return new Promise(async (resolve, reject) => {
            const transactionID = Buffer.alloc(2);

            transactionID.writeUInt16BE(randomInt(2 ** 16));

            const timeout = setTimeout(
                () => reject(new Error("get_peers timed out")),
                16000
            );

            const msg = await sendUDPMessage(
                new URL(`udp://${address}:${port}`),
                encode({
                    a: { id: config.nodeID, info_hash: infoHash },
                    q: Buffer.from("get_peers"),
                    t: transactionID,
                    y: Buffer.from("q"),
                })
            );

            clearTimeout(timeout);

            const decoded = decode(msg, false);

            const receivedTransactionID = decoded.t;

            if (!receivedTransactionID.equals(transactionID)) {
                reject(new Error("Transaction id did not match"));

                return;
            }

            if (decoded.y.equals(Buffer.from("e"))) {
                const code = decoded.e[0];
                const message = decoded.e[1].toString();

                reject(new Error(`${message} (${code})`));

                return;
            }

            if (!decoded.y.equals(Buffer.from("r"))) {
                reject(
                    new Error(`Unexpected message type ${decoded.y.toString()}`)
                );

                return;
            }

            const result = { id: decoded.r.id, token: decoded.r.token };

            if (decoded.r.nodes !== undefined) {
                result.nodes = decodeNodes(decoded.r.nodes);
            }

            if (decoded.r.values !== undefined) {
                result.peers = decodePeers(Buffer.concat(decoded.r.values));
            }

            resolve(result);
        });
    }

    ping(port, address) {
        return new Promise(async (resolve, reject) => {
            if (config.verbose) {
                console.log(`ping ${address}:${port}`);
            }

            const transactionID = Buffer.alloc(2);

            transactionID.writeUInt16BE(randomInt(2 ** 16));

            const timeout = setTimeout(
                () => reject(new Error("ping timed out")),
                16000
            );

            const msg = await sendUDPMessage(
                new URL(`udp://${address}:${port}`),
                encode({
                    a: { id: config.nodeID },
                    q: Buffer.from("ping"),
                    t: transactionID,
                    y: Buffer.from("q"),
                })
            );

            clearTimeout(timeout);

            const decoded = decode(msg);

            const receivedTransactionID = decoded.t;

            if (!receivedTransactionID.equals(transactionID)) {
                reject(new Error("Transaction id did not match"));

                return;
            }

            if (decoded.y.equals(Buffer.from("e"))) {
                const code = decoded.e[0];
                const message = decoded.e[1].toString();

                reject(new Error(`${message} (${code})`));

                return;
            }

            if (!decoded.y.equals(Buffer.from("r"))) {
                reject(
                    new Error(`Unexpected message type ${decoded.y.toString()}`)
                );

                return;
            }

            resolve(decoded.r.id);
        });
    }

    targetToBucket(target) {
        let bucket = 0;

        for (let i = 0; i < config.nodeID.length; ++i) {
            const leadingZeros = Math.clz32(config.nodeID[i] ^ target[i]);

            bucket += leadingZeros;

            if (leadingZeros < 8) {
                break;
            }
        }

        let i;

        for (i = 0; i < this.#buckets.length; ++i) {
            if (this.#buckets[i].length < 8) {
                break;
            }
        }

        if (i < this.#buckets.length) {
            this.#buckets[i].push(target);
        } else {
            // Split the last bucket and rearrange the nodes
        }

        assert(this.#buckets.length <= 160);
    }

    save() {}
    load() {}
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
