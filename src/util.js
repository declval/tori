import { createHash } from "node:crypto";
import { createSocket } from "node:dgram";
import { lookup } from "node:dns/promises";

export function decodePeers(buffer) {
    const peers = [];

    for (let i = 0; i < buffer.length; i += 6) {
        const peer = {};

        peer.ip = [...buffer.subarray(i, i + 4)].join(".");
        peer.port = buffer.readUInt16BE(i + 4);

        peers.push(peer);
    }

    return peers;
}

export function sendUDPMessage(url, buffer) {
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

        try {
            const { address } = await lookup(url.hostname, { family: 4 });

            socket.send(buffer, url.port, address);
        } catch (error) {
            reject(error);
        }
    });
}

export function sha1sum(buffer) {
    return createHash("sha1").update(buffer).digest();
}
