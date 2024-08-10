import { Buffer } from "node:buffer";
import { randomFillSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";

const { name, version } = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "package.json"))
);

export default {
    name,
    nodeID: generateNodeID(),
    outputDirectory: cwd(),
    peerID: generatePeerID(name, version),
    verbose: false,
    version,
};

function generateNodeID() {
    const buffer = Buffer.alloc(20);

    randomFillSync(buffer);

    return buffer;
}

function generatePeerID(name, version) {
    const [major, minor, patch] = version.split(".");
    const buffer = Buffer.alloc(20);

    if (major.length > 1 || minor.length > 2 || patch.length > 1) {
        throw new Error("Unsupported version number");
    }

    const written = buffer.write(
        `-${name.slice(0, 2).padStart(2, "-")}${major}${minor.padStart(2, "0")}${patch}-`
    );

    randomFillSync(buffer, written);

    return buffer;
}
