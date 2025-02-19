function Lock(rootFolder) {
    const fsname = "fs";
    const fs = require(fsname);
    const pathname = "path";
    const path = require(pathname);
    const logger = $$.getLogger("SimpleLock", "apihub/logger");

    const STORAGE = "external-volume/locks";
    const storage = path.join(rootFolder, STORAGE);
    let fileStructureEnsured = false;

    function ensureFolder(callback) {
        if (fileStructureEnsured) {
            return callback();
        }
        fs.mkdir(storage, {recursive: true}, (err) => {
            if (!err) {
                fileStructureEnsured = true;
                return callback();
            }
            logger.error("Failed to ensure folder structure for locks", err);
            callback(err);
        });
    }

    function getLockFolderPath(id) {
        const crypto = require("opendsu").loadApi("crypto");
        let name = crypto.encodeBase58(id).toString();

        return path.join(storage, name);
    }

    function getLockFilePath(id) {
        return path.join(getLockFolderPath(id), "lock");
    }

    function getLockData(id, callback) {
        ensureFolder((err) => {
            if (err) {
                return callback(err);
            }

            fs.readFile(getLockFilePath(id), (err, lockData) => {
                if (err) {
                    if (err.code === "ENOENT") {
                        return callback(undefined, {});
                    }
                    return callback(err);
                }
                try {
                    lockData = JSON.parse(lockData.toString());
                } catch (err) {
                    return callback(undefined, {});
                }
                return callback(undefined, lockData);
            });
        });
    }

    function cleanLockFiles(id, callback) {
        fs.rm(getLockFolderPath(id), {recursive: true, force: true}, (err) => {
            if (err) {
                if (err.code === "ENOENT") {
                    return callback(undefined);
                }
                return callback(err);
            }
            return callback(undefined);
        });
    }

    function checkIfLockExists(id, callback) {
        getLockData(id, (err, lockData) => {
            if (err) {
                return callback(err);
            }
            logger.debug("lockData.expire", lockData.expire, Date.now(), Number(lockData.expire) < Date.now());
            if (!lockData.expire || Number(lockData.expire) < Date.now()) {
                return cleanLockFiles(id, (err) => {
                    if (err) {
                        return callback(err);
                    }
                    return callback(undefined, false);
                });
            }

            logger.debug("cleaning lock files, time to expire", Number(lockData.expire) < Date.now());
            logger.debug("cleaning lock files", lockData);
            return callback(undefined, true);

        });
    }

    function constructLockData(secret, period) {
        return {expire: Date.now() + Number(period), secret};
    }

    this.putLock = function (id, secret, period, callback) {
        if(typeof period === "function"){
            callback = period;
            period = 1000 * 30;
        }
        checkIfLockExists(id, (err, locked) => {
            if (err) {
                return callback(err);
            }
            if (locked) {
                return callback(undefined, false);
            }

            fs.mkdir(getLockFolderPath(id), (err) => {
                if (err) {
                    logger.error("Failed to write lock", err);
                    return callback(err);
                }
                fs.writeFile(getLockFilePath(id), JSON.stringify(constructLockData(secret, period)), (err) => {
                    if (err) {
                        logger.error("Failed to write lock", err);
                        return callback(err);
                    }
                    callback(undefined, true);
                });
            });
        });
    }

    this.removeLock = function (id, secret, callback) {
        getLockData(id, (err, lockData) => {
            if (err) {
                return callback(err);
            }
            if (lockData && lockData.secret === secret) {
                return fs.rm(getLockFilePath(id), (err) => {
                    if (err) {
                        logger.error("Failed to delete lock", err);
                        return callback(err);
                    }
                    callback(undefined, true);
                });
            }
            return callback(undefined, false);
        });
    }

    this.putLockAsync = $$.promisify(this.putLock, this);
    this.removeLockAsync = $$.promisify(this.removeLock, this);
}

module.exports = Lock;