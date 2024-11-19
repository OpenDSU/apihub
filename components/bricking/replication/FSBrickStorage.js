const backupUtils = require("../../../http-wrapper/utils/backupUtils");

class FSBrickStorage {
    constructor(domainName, domainFolder, serverRoot, fsBrickPathsManager, domainConfig) {
        this.domain = domainName;
        const FSBrickPathsManager = require("./FSBrickPathsManager");
        this.fsBrickPathsManager = fsBrickPathsManager || new FSBrickPathsManager(2);
        this.fsBrickPathsManager.storeDomainPath(this.domain, domainFolder, serverRoot);
        this.domainConfig = domainConfig;
    }

    getBrick(hash, callback) {
        callback = $$.makeSaneCallback(callback);

        this.getBrickAsync(hash)
            .then(result => callback(undefined, result))
            .catch(error => callback(error));
    }

    async getBrickAsync(hash) {
        const fs = require("fs");
        const brickPath = this.fsBrickPathsManager.resolveBrickPath(this.domain, hash);
        await $$.promisify(fs.access)(brickPath);
        try {
            return await $$.promisify(fs.readFile)(brickPath);
        } catch (error) {
            if (this.domainConfig && this.domainConfig.enableBackup) {
                const backupServerUrl = this.domainConfig.backupServerUrl;
                await $$.promisify(backupUtils.restoreFileFromBackup)(backupServerUrl, brickPath);
                return await $$.promisify(fs.readFile)(brickPath);
            }
            throw error;
        }
    }

    async brickExists(hash) {
        const fs = require("fs");
        const brickPath = this.fsBrickPathsManager.resolveBrickPath(this.domain, hash);
        try {
            await $$.promisify(fs.access)(brickPath);
            return true;
        } catch (error) {
            if (this.domainConfig && this.domainConfig.enableBackup) {
                const backupServerUrl = this.domainConfig.backupServerUrl;
                try {
                    await $$.promisify(backupUtils.restoreFileFromBackup)(backupServerUrl, brickPath);
                    return true;
                } catch (e) {
                }
            }
        }
        return false
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
        const brickDirPath = this.fsBrickPathsManager.resolveBrickDirname(this.domain, hash);
        await $$.promisify(fs.mkdir)(brickDirPath, {recursive: true});
        //await $$.promisify(fs.access)(brickDirPath);

        const brickPath = this.fsBrickPathsManager.resolveBrickPath(this.domain, hash);
        await $$.promisify(fs.writeFile)(brickPath, data);
        if (this.domainConfig && this.domainConfig.enableBackup) {
            backupUtils.notifyBackup(brickPath);
        }
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
        const brickPath = this.fsBrickPathsManager.resolveBrickPath(this.domain, hash);
        await $$.promisify(fs.access)(brickPath);
        await $$.promisify(fs.unlink)(brickPath);

        const brickDirPath = this.fsBrickPathsManager.resolveBrickDirname(this.domain, hash);
        await $$.promisify(fs.access)(brickDirPath);
        await $$.promisify(removeDir)(brickDirPath, {recursive: true});
    }
}

function create(...params) {
    return new FSBrickStorage(...params);
}

module.exports = {
    create
};