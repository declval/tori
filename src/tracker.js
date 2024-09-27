import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { decode } from "./bencode.js";
import { options } from "./main.js";

export class Tracker {
    #infoHash;
    #peerIPs;

    constructor(announceList, infoHash) {
        this.#infoHash = infoHash;
        this.announceList = announceList;

        this.#peerIPs = new Set();
        this.complete = null;
        this.incomplete = null;
        this.interval = null;
        this.peers = [];
    }

    async completed(downloaded, left, uploaded) {
        await this.#request(downloaded, "completed", left, uploaded);
    }

    async request(downloaded, left, uploaded) {
        await this.#request(downloaded, "", left, uploaded);
    }

    async started(downloaded, left, uploaded) {
        await this.#request(downloaded, "started", left, uploaded);
    }

    async stopped(downloaded, left, uploaded) {
        await this.#request(downloaded, "stopped", left, uploaded);
    }

    async #request(downloaded, event, left, uploaded) {
        if (options.verbose) {
            console.log(`Tracker request${event === "" ? "" : ` (${event})`}`);
        }

        let response = null;

        outer: for (const tier of this.announceList) {
            for (let i = 0; i < tier.length; ++i) {
                const announce = tier[i];

                const url = new URL(announce);

                url.searchParams.set("downloaded", downloaded.toString());
                url.searchParams.set("event", event);
                url.searchParams.set("left", left.toString());
                url.searchParams.set("port", "6881");
                url.searchParams.set("uploaded", uploaded.toString());

                url.search += `&info_hash=${percentEncode(this.#infoHash)}`;
                url.search += `&peer_id=${percentEncode(options.peerID)}`;

                try {
                    response = await fetch(url);

                    tier.unshift(...tier.splice(i, 1));

                    break outer;
                } catch (error) {
                    if (options.verbose) {
                        console.error(error.message);
                    }
                }
            }
        }

        if (response === null) {
            throw new Error("Not a single tracker responded");
        }

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
            for (let i = 0; i < decoded.peers.length; i += 6) {
                const peer = {};

                peer.ip = [...decoded.peers.subarray(i, i + 4)].join(".");
                peer.port = decoded.peers.readUInt16BE(i + 4);

                if (!this.#peerIPs.has(peer.ip)) {
                    this.#peerIPs.add(peer.ip);
                    this.peers.push(peer);
                }
            }
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
}

function percentEncode(buffer) {
    return Array.from(buffer)
        .map((value) => `%${value.toString(16).padStart(2, "0")}`)
        .join("");
}
