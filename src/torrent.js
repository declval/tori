import { createHash } from "node:crypto";
import { decode, encode } from "./bencode.js";

export class Torrent {
    constructor(buffer) {
        const decoded = decode(buffer);

        if (decoded.announce !== undefined) {
            this.announce = decoded.announce.toString();
        }

        if (decoded["announce-list"] !== undefined) {
            this.announceList = decoded["announce-list"].map((tier) =>
                tier.map((announce) => announce.toString())
            );
        }

        if (decoded.comment !== undefined) {
            this.comment = decoded.comment.toString();
        }

        if (decoded["created by"] !== undefined) {
            this.createdBy = decoded["created by"].toString();
        }

        if (decoded["creation date"] !== undefined) {
            this.creationDate = new Date(decoded["creation date"] * 1000);
        }

        this.infoHash = createHash("sha1")
            .update(encode(decoded.info))
            .digest();

        if (decoded.info.length !== undefined) {
            this.length = decoded.info.length;
        } else {
            this.length = decoded.info.files.reduce(
                (sum, { length }) => sum + length,
                0
            );
        }

        this.name = decoded.info.name.toString();

        this.pieceLength = decoded.info["piece length"];

        this.hashes = [];

        for (let i = 0; i < decoded.info.pieces.length; i += 20) {
            this.hashes.push(decoded.info.pieces.subarray(i, i + 20));
        }

        if (decoded["url-list"] !== undefined) {
            this.urlList = decoded["url-list"].map((url) => url.toString());
        }
    }
}
