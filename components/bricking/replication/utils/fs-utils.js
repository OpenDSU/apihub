async function checkIfPathExists(path) {
    try {
        const fs = require("fs");
        await $$.promisify(fs.access)(path);
        return true;
    } catch (error) {
        return false;
    }
}

async function ensurePathExists(path) {
    const pathExists = await checkIfPathExists(path);
    if (!pathExists) {
        const fs = require("fs");
        await $$.promisify(fs.mkdir)(path, {recursive: true});
    }
}

module.exports = {
    checkIfPathExists,
    ensurePathExists,
};