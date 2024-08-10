import { Buffer } from "node:buffer";
import { randomInt } from "node:crypto";
import { URL } from "node:url";
import { decode } from "./bencode.js";
import config from "./config.js";
import * as udpTrackerMessage from "./udpTrackerMessage.js";
import { decodePeers, sendUDPMessage } from "./util.js";

export class Tracker {
    #connectionID;
    #download;
    #interval;
    #intervalTimeout;
    #key;
    #tiers;

    constructor(download) {
        this.#download = download;

        this.#connectionID = null;
        this.#interval = null;
        this.#intervalTimeout = null;
        this.#key = randomInt(2 ** 32);
        this.#tiers =
            this.#download.torrent.announceList !== undefined
                ? this.#download.torrent.announceList.map((tier) =>
                      toShuffled(tier)
                  )
                : [[this.#download.torrent.announce]];
        this.complete = null;
        this.incomplete = null;
        this.peerIPs = new Set();
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
                if (config.verbose) {
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
        let success = false;

        outer: for (const tier of this.#tiers) {
            for (let i = 0; i < tier.length; ++i) {
                const announce = tier[i];

                const url = new URL(announce);

                if (config.verbose) {
                    console.log(
                        `Tracker request${event === "" ? "" : ` (${event})`}: ${url}`
                    );
                }

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
                    if (config.verbose) {
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

        url.search += `&info_hash=${percentEncode(this.#download.torrent.infoHash())}`;
        url.search += `&peer_id=${percentEncode(config.peerID)}`;

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

        this.#interval = decoded.interval;

        const peers = [];

        if (Buffer.isBuffer(decoded.peers)) {
            peers.push(...decodePeers(decoded.peers));
        } else {
            peers.push(
                ...decoded.peers.map((peer) => {
                    peer.ip = peer.ip.toString();

                    if (peer.hasOwnProperty("peer id")) {
                        peer.peerID = peer["peer id"];
                        delete peer["peer id"];
                    }

                    return peer;
                })
            );
        }

        for (const peer of peers) {
            if (!this.peerIPs.has(peer.ip)) {
                this.peerIPs.add(peer.ip);
                this.peers.push(peer);
            }
        }

        const warningMessage = decoded["warning message"]?.toString();

        if (warningMessage !== undefined) {
            if (config.verbose) {
                console.warn(warningMessage);
            }
        }
    }

    async #requestUDP(url, event) {
        if (event === "") {
            event = udpTrackerMessage.EVENT_NONE;
        } else if (event === "completed") {
            event = udpTrackerMessage.EVENT_COMPLETED;
        } else if (event === "started") {
            event = udpTrackerMessage.EVENT_STARTED;
        } else if (event === "stopped") {
            event = udpTrackerMessage.EVENT_STOPPED;
        }

        let delay = 15;

        this.#connectionID = null;

        while (delay <= 3840) {
            try {
                if (this.#connectionID === null) {
                    await this.#udpTrackerConnect(url, delay);
                }

                await this.#udpTrackerAnnounce(url, event, delay);

                break;
            } catch (error) {
                if (config.verbose) {
                    console.error(error.message);
                }

                throw new Error("Break");
            }

            delay *= 2;
        }
    }

    #udpTrackerAnnounce(url, event, delay) {
        return new Promise(async (resolve, reject) => {
            const transactionID = randomInt(2 ** 32);

            const timeout = setTimeout(
                () =>
                    reject(
                        new Error(
                            `Announce request timed out after ${delay} seconds`
                        )
                    ),
                delay * 1000
            );

            let msg;

            try {
                msg = await sendUDPMessage(
                    url,
                    udpTrackerMessage.encodeAnnounce(
                        this.#connectionID,
                        transactionID,
                        this.#download.torrent.infoHash(),
                        config.peerID,
                        BigInt(this.#download.downloaded),
                        BigInt(this.#download.leftToDownload()),
                        BigInt(this.#download.uploaded),
                        event,
                        this.#key,
                        50,
                        6881
                    )
                );
            } catch (error) {
                reject(error);

                return;
            }

            clearTimeout(timeout);

            if (msg.length < 8) {
                reject(new Error("Message is too short"));

                return;
            }

            const action = msg.readUInt32BE();

            const receivedTransactionID = msg.readUInt32BE(
                udpTrackerMessage.ACTION_LENGTH
            );

            if (receivedTransactionID !== transactionID) {
                reject(new Error("Transaction id did not match"));

                return;
            }

            if (msg.length < 20) {
                reject(new Error("Message is too short for announce"));

                return;
            }

            msg = msg.subarray(
                udpTrackerMessage.ACTION_LENGTH +
                    udpTrackerMessage.TRANSACTION_ID_LENGTH
            );

            if (action === udpTrackerMessage.ACTION_ERROR) {
                const errorMessage = udpTrackerMessage.decodeError(msg);

                reject(new Error(errorMessage));

                return;
            }

            if (action !== udpTrackerMessage.ACTION_ANNOUNCE) {
                reject(new Error("Action is not announce"));

                return;
            }

            const { interval, leechers, seeders, peers } =
                udpTrackerMessage.decodeAnnounce(msg);

            this.#interval = interval;
            this.complete = seeders;
            this.incomplete = leechers;

            for (const peer of peers) {
                if (!this.peerIPs.has(peer.ip)) {
                    this.peerIPs.add(peer.ip);
                    this.peers.push(peer);
                }
            }

            resolve();
        });
    }

    #udpTrackerConnect(url, delay) {
        return new Promise(async (resolve, reject) => {
            const transactionID = randomInt(2 ** 32);

            const timeout = setTimeout(
                () =>
                    reject(
                        new Error(
                            `Connect request timed out after ${delay} seconds`
                        )
                    ),
                delay * 1000
            );

            let msg;

            try {
                msg = await sendUDPMessage(
                    url,
                    udpTrackerMessage.encodeConnect(transactionID)
                );
            } catch (error) {
                reject(error);

                return;
            }

            clearTimeout(timeout);

            if (msg.length < 8) {
                reject(new Error("Message is too short"));

                return;
            }

            const action = msg.readUInt32BE();

            const receivedTransactionID = msg.readUInt32BE(
                udpTrackerMessage.ACTION_LENGTH
            );

            if (receivedTransactionID !== transactionID) {
                reject(new Error("Transaction id did not match"));

                return;
            }

            if (msg.length < 16) {
                reject(new Error("Message is too short for connect"));

                return;
            }

            msg = msg.subarray(
                udpTrackerMessage.ACTION_LENGTH +
                    udpTrackerMessage.TRANSACTION_ID_LENGTH
            );

            if (action === udpTrackerMessage.ACTION_ERROR) {
                const errorMessage = udpTrackerMessage.decodeError(msg);

                reject(new Error(errorMessage));

                return;
            }

            if (action !== udpTrackerMessage.ACTION_CONNECT) {
                reject(new Error("Action is not connect"));

                return;
            }

            const connectionID = udpTrackerMessage.decodeConnect(msg);

            this.#connectionID = connectionID;

            setTimeout(() => (this.#connectionID = null), 60000);

            resolve();
        });
    }
}

function percentEncode(buffer) {
    return Array.from(buffer)
        .map((value) => `%${value.toString(16).padStart(2, "0")}`)
        .join("");
}

function toShuffled(array) {
    const shuffled = [...array];

    for (let i = 0; i < shuffled.length - 1; ++i) {
        const j = randomInt(i, shuffled.length);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
}
