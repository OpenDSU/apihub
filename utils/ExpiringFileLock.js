function ExpiringFileLock(folderLock, timeout) {
    const fsPromisesName = 'node:fs/promises';
    const fsPromises = require(fsPromisesName);

    function asyncSleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    this.lock = async () => {
        while (true) {
            try {
                const stat = await fsPromises.stat(folderLock);
                const currentTime = Date.now();
                // console.log("checking if lock is expired", folderLock, stat.ctime.getTime(), currentTime - timeout, stat.ctime.getTime() < currentTime - timeout);
                if (stat.ctime.getTime() < currentTime - timeout) {
                    await fsPromises.rmdir(folderLock);
                    console.log("Removed expired lock", folderLock);
                }
            } catch (e) {
                // No such file or directory
            }

            try {
                await fsPromises.mkdir(folderLock, {recursive: true});
                return;
            } catch (e) {
                console.log("Retrying to acquire lock", folderLock, "after 100ms");
                await asyncSleep(100);
            }
        }
    }

    this.unlock = async () => {
        try {
            await fsPromises.rmdir(folderLock);
        } catch (e) {
            // Nothing to do
        }
    }
}

module.exports = {
    getLock: (folderLock, timeout) => {
        return new ExpiringFileLock(folderLock, timeout);
    }
};