class FSBrickPathsManager {
    constructor(bricksFolderSize = 2) {
        this.brickPaths = {};
        this.bricksFolderSize = bricksFolderSize;
    }

    verifyBrickHash(brickHash) {
        if (!brickHash || typeof brickHash !== 'string') {
            throw Error('[Bricking] No hash specified');
        }

        if (brickHash.length < this.bricksFolderSize) {
            throw Error(`[Bricking] Hash "${brickHash}" is too small`);
        }
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
        this.verifyBrickHash(brickHash);
        return require("path").join(this.brickPaths[domainName], brickHash.substr(0, this.bricksFolderSize));
    }
}

module.exports = FSBrickPathsManager;