import { Buffer } from "node:buffer";
import { randomInt } from "node:crypto";
import { createSocket } from "node:dgram";
import { lookup } from "node:dns/promises";
import { URL } from "node:url";
import { decode } from "./bencode.js";
import { options } from "./main.js";
import * as udpTrackerMessage from "./udpTrackerMessage.js";

export class Tracker {
    #announceList;
    #connectionID;
    #download;
    #interval;
    #intervalTimeout;
    #key;
    #peerIPs;

    constructor(download) {
        this.#download = download;

        this.#announceList =
            this.#download.metadata.announceList !== undefined
                ? this.#download.metadata.announceList.map((tier) =>
                      shuffle(tier)
                  )
                : [[this.#download.metadata.announce]];
        this.#connectionID = null;
        this.#interval = null;
        this.#intervalTimeout = null;
        this.#key = randomInt(2 ** 32);
        this.#peerIPs = new Set();
        this.complete = null;
        this.incomplete = null;
        this.peers = [];
    }

    async completed() {
        clearInterval(this.#intervalTimeout);

        await this.#request("completed");
    }

    async started() {
        await this.#request("started");

        this.#intervalTimeout = setInterval(async () => {
            try {
                await this.#request("");
            } catch (error) {
                if (options.verbose) {
                    console.error(`Tracker request failed: ${error.message}`);
                }
            }
        }, this.#interval * 1000);
    }

    async stopped() {
        clearInterval(this.#intervalTimeout);

        await this.#request("stopped");
    }

    async #request(event) {
        if (options.verbose) {
            console.log(`Tracker request${event === "" ? "" : ` (${event})`}`);
        }

        let success = false;

        outer: for (const tier of this.#announceList) {
            for (let i = 0; i < tier.length; ++i) {
                const announce = tier[i];

                const url = new URL(announce);

                try {
                    if (url.protocol === "http:" || url.protocol === "https:") {
                        await this.#requestHTTP(url, event);
                    } else if (url.protocol === "udp:") {
                        await this.#requestUDP(url, event);
                    } else {
                        throw new Error(
                            `Tracker protocol ${url.protocol} is not supported`
                        );
                    }

                    success = true;
                    tier.unshift(...tier.splice(i, 1));

                    break outer;
                } catch (error) {
                    if (options.verbose) {
                        console.error(error.message);
                    }
                }
            }
        }

        if (!success) {
            throw new Error("Not a single tracker responded");
        }
    }

    async #requestHTTP(url, event) {
        url.searchParams.set(
            "downloaded",
            this.#download.downloaded.toString()
        );
        url.searchParams.set("event", event);
        url.searchParams.set(
            "left",
            this.#download.leftToDownload().toString()
        );
        url.searchParams.set("port", "6881");
        url.searchParams.set("uploaded", this.#download.uploaded.toString());

        url.search += `&info_hash=${percentEncode(this.#download.metadata.infoHash)}`;
        url.search += `&peer_id=${percentEncode(options.peerID)}`;

        const response = await fetch(url);

        const decoded = decode(Buffer.from(await response.arrayBuffer()));

        const failureReason = decoded["failure reason"]?.toString();

        if (failureReason !== undefined) {
            throw new Error(failureReason);
        }

        if (decoded.complete !== undefined) {
            this.complete = decoded.complete;
        }

        if (decoded.incomplete !== undefined) {
            this.incomplete = decoded.incomplete;
        }

        this.interval = decoded.interval;

        if (Buffer.isBuffer(decoded.peers)) {
            this.#parseCompactPeers(decoded.peers);
        } else {
            decoded.peers.forEach((peer) => {
                peer.ip = peer.ip.toString();

                if (peer.hasOwnProperty("peer id")) {
                    peer.peerID = peer["peer id"];
                    delete peer["peer id"];
                }

                if (!this.#peerIPs.has(peer.ip)) {
                    this.#peerIPs.add(peer.ip);
                    this.peers.push(peer);
                }
            });
        }

        const warningMessage = decoded["warning message"]?.toString();

        if (warningMessage !== undefined) {
            if (options.verbose) {
                console.warn(warningMessage);
            }
        }
    }

    async #requestUDP(url, event) {
        if (this.#connectionID === null) {
            await this.#udpTrackerConnect(url);
        }

        if (event === "") {
            event = udpTrackerMessage.EVENT_NONE;
        } else if (event === "completed") {
            event = udpTrackerMessage.EVENT_COMPLETED;
        } else if (event === "started") {
            event = udpTrackerMessage.EVENT_STARTED;
        } else if (event === "stopped") {
            event = udpTrackerMessage.EVENT_STOPPED;
        }

        await this.#udpTrackerAnnounce(url, event);
    }

    #udpTrackerAnnounce(url, event) {
        return new Promise(async (resolve, reject) => {
            const transactionID = randomInt(2 ** 32);

            const socket = createSocket("udp4")
                .on("error", (error) => {
                    socket.close();

                    reject(error);
                })
                .on("message", (msg, _rinfo) => {
                    try {
                        this.#udpTrackerError(msg, transactionID);
                    } catch (error) {
                        reject(error);

                        return;
                    }

                    if (msg.length < 20) {
                        reject(
                            new Error(
                                "Message should be at least 20 bytes for announce"
                            )
                        );

                        return;
                    }

                    const {
                        action,
                        transactionID: receivedTransactionID,
                        interval,
                        leechers,
                        seeders,
                        peers,
                    } = udpTrackerMessage.decodeAnnounce(msg);

                    console.log(
                        `[${msg.length}]`,
                        action,
                        receivedTransactionID,
                        interval,
                        leechers,
                        seeders,
                        peers
                    );

                    this.#parseCompactPeers(peers);

                    if (action !== udpTrackerMessage.ACTION_ANNOUNCE) {
                        reject(new Error("Action is not announce"));

                        return;
                    }

                    if (receivedTransactionID !== transactionID) {
                        reject(new Error("Transaction id did not match"));

                        return;
                    }

                    socket.close();

                    resolve();
                });

            let ip;

            try {
                const { address } = await lookup(url.hostname, { family: 4 });

                ip = address;
            } catch (error) {
                reject(error);

                return;
            }

            socket.send(
                udpTrackerMessage.encodeAnnounce(
                    this.#connectionID,
                    transactionID,
                    this.#download.metadata.infoHash,
                    options.peerID,
                    BigInt(this.#download.downloaded),
                    BigInt(this.#download.leftToDownload()),
                    BigInt(this.#download.uploaded),
                    event,
                    this.#key,
                    50,
                    6881
                ),
                url.port,
                ip
            );
        });
    }

    #udpTrackerConnect(url) {
        return new Promise(async (resolve, reject) => {
            const transactionID = randomInt(2 ** 32);

            const socket = createSocket("udp4")
                .on("error", (error) => {
                    socket.close();

                    reject(error);
                })
                .on("message", (msg, _rinfo) => {
                    try {
                        this.#udpTrackerError(msg, transactionID);
                    } catch (error) {
                        reject(error);

                        return;
                    }

                    if (msg.length < 16) {
                        reject(
                            new Error(
                                "Message should be at least 16 bytes for connect"
                            )
                        );

                        return;
                    }

                    const {
                        action,
                        transactionID: receivedTransactionID,
                        connectionID,
                    } = udpTrackerMessage.decodeConnect(msg);

                    console.log(
                        `[${msg.length}]`,
                        action,
                        receivedTransactionID,
                        connectionID
                    );

                    if (action !== udpTrackerMessage.ACTION_CONNECT) {
                        reject(new Error("Action is not connect"));

                        return;
                    }

                    if (receivedTransactionID !== transactionID) {
                        reject(new Error("Transaction id did not match"));

                        return;
                    }

                    this.#connectionID = connectionID;

                    setTimeout(() => (this.#connectionID = null), 60000);

                    socket.close();

                    resolve();
                });

            let ip;

            try {
                const { address } = await lookup(url.hostname, { family: 4 });

                ip = address;
            } catch (error) {
                reject(error);

                return;
            }

            socket.send(
                udpTrackerMessage.encodeConnect(transactionID),
                url.port,
                ip
            );
        });
    }

    #udpTrackerError(msg, transactionID) {
        if (msg.length < 8) {
            return;
        }

        const {
            action,
            transactionID: receivedTransactionID,
            errorMessage,
        } = udpTrackerMessage.decodeError(msg);

        if (action !== udpTrackerMessage.ACTION_ERROR) {
            return;
        }

        console.log(
            `[${msg.length}]`,
            action,
            receivedTransactionID,
            errorMessage
        );

        if (receivedTransactionID !== transactionID) {
            throw new Error("Transaction id did not match");
        }

        throw new Error(errorMessage);
    }

    #parseCompactPeers(buffer) {
        for (let i = 0; i < buffer.length; i += 6) {
            const peer = {};

            peer.ip = [...buffer.subarray(i, i + 4)].join(".");
            peer.port = buffer.readUInt16BE(i + 4);

            if (!this.#peerIPs.has(peer.ip)) {
                this.#peerIPs.add(peer.ip);
                this.peers.push(peer);
            }
        }
    }
}

function percentEncode(buffer) {
    return Array.from(buffer)
        .map((value) => `%${value.toString(16).padStart(2, "0")}`)
        .join("");
}

function shuffle(array) {
    const shuffled = [...array];

    for (let i = 0; i < shuffled.length - 1; ++i) {
        const j = randomInt(i, shuffled.length);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
}
