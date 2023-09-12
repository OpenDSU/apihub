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
                if (stat.ctime.getTime() < Date.now() - timeout) {
                    await fsPromises.rmdir(folderLock);
                    console.log("Removed expired lock", folderLock);
                }
            } catch (e) {
                // No such file or directory
            }

            try {
                await fsPromises.mkdir(folderLock);
                return;
            } catch (e) {
                await asyncSleep(100);
            }
        }
    }

    this.unlock = async () => {
        try {
            await fsPromises.rmdir(folderLock);
        }catch (e) {
            // Nothing to do
        }
    }
}

module.exports = {
    getLock: (folderLock, timeout) => {
        return new ExpiringFileLock(folderLock, timeout);
    }
};