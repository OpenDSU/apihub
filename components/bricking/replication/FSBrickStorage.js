class FSBrickPathsManager {
    constructor() {
        this.brickPaths = {};
        this.utils = require("./utils.js");
    }

    storeDomainPath(domainName, domainFolder, serverRoot) {
        if (!this.brickPaths[domainName]) {
            this.brickPaths[domainName] = require("path").join(serverRoot || "", domainFolder || domainName);
        }
    }

    removeDomainPath(domainName) {
        delete this.brickPaths[domainName];
    }

    resolveBrickPath(domainName, brickHash) {
        return require("path").join(this.resolveBrickDirname(domainName, brickHash), brickHash);
    }

    resolveBrickDirname(domainName, brickHash) {
        this.utils.verifyBrickHash(brickHash);
        return require("path").join(this.brickPaths[domainName], brickHash.substr(0, this.utils.HASH_MAX_SIZE));
    }

    getUtils() {
        return this.utils;
    }
}

const fsBrickPathsManager = new FSBrickPathsManager();

class FSBrickStorage {
    constructor(domainName, domainFolder, serverRoot) {
        this.domain = domainName;

        fsBrickPathsManager.storeDomainPath(this.domain, domainFolder, serverRoot);
    }

    getBrick(hash, callback) {
        callback = $$.makeSaneCallback(callback);

        this.getBrickAsync(hash)
            .then(result => callback(undefined, result))
            .catch(error => callback(error));
    }

    async getBrickAsync(hash) {
        const fs = require("fs");
        const brickPath = fsBrickPathsManager.resolveBrickPath(this.domain, hash);
        await $$.promisify(fs.access)(brickPath);
        return await $$.promisify(fs.readFile)(brickPath);
    }

    addBrick(data, callback) {
        callback = $$.makeSaneCallback(callback);

        this.addBrickAsync(data)
            .then(result => callback(undefined, result))
            .catch(error => callback(error));
    }

    async addBrickAsync(data) {
        const fs = require("fs");
        const crypto = require("opendsu").loadAPI("crypto");
        const hash = crypto.sha256(data);

        // TODO: use workers from OpenDSU apiSpace
        // const pool = workers.createPool() or (pool probably should be at FSBrickStorage ctor level)
        // await $$.promisify(pool.runSyncFunction)("crypto", "sha256", data);
console.time("bricking")
        const brickDirPath = fsBrickPathsManager.resolveBrickDirname(this.domain, hash);
console.log("BrickDirPath", brickDirPath);
console.time("mkdir");
        await $$.promisify(fs.mkdir)(brickDirPath, { recursive: true });
console.timeEnd("mkdir");
        //await $$.promisify(fs.access)(brickDirPath);

        const brickPath = fsBrickPathsManager.resolveBrickPath(this.domain, hash);
console.timeEnd("bricking");
        await $$.promisify(fs.writeFile)(brickPath, data);

        return hash;
    }

    deleteBrick(hash, callback) {
        callback = $$.makeSaneCallback(callback);

        this.deleteBrickAsync(hash)
            .then(result => callback(undefined, result))
            .catch(error => callback(error));
    }

    async deleteBrickAsync(hash) {
        const fs = require("fs");
        const removeDir = require("swarmutils").removeDir;
        const brickPath = fsBrickPathsManager.resolveBrickPath(this.domain, hash);
        await $$.promisify(fs.access)(brickPath);
        await $$.promisify(fs.unlink)(brickPath);

        const brickDirPath = fsBrickPathsManager.resolveBrickDirname(this.domain, hash);
        await $$.promisify(fs.access)(brickDirPath);
        await $$.promisify(removeDir)(brickDirPath, { recursive: true });
    }

    get utils() {
        return ({ ...fsBrickPathsManager.getUtils() })
    }
}

function create(...params) {
    return new FSBrickStorage(...params);
}

module.exports = {
    create
};