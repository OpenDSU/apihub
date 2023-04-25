const path = require("path");
const fs = require("fs");
const config = require("../../config");

const logger = $$.getLogger("controller", "apihub/versionlessDSU");

let versionlessDSUFolderPath;

const VERSIONLESS_DSU_PATH_PREFIX = "/versionlessdsu/";

async function init(server) {
    logger.debug(`[VersionlessDSU] Registering VersionlessDSU component`);
    versionlessDSUFolderPath = path.join(server.rootFolder, config.getConfig("externalStorage"), "versionlessdsu");
    logger.debug(`[VersionlessDSU] Ensuring VersionlessDSU folder (${versionlessDSUFolderPath}) is created`);
    try {
        await $$.promisify(fs.mkdir)(versionlessDSUFolderPath, { recursive: true });
    } catch (error) {
        logger.error("[VersionlessDSU] Failed to create VersionlessDSU folder", error);
    }
}

function sendVersionlessDSUContent(parsedDSUContent, response) {
    response.statusCode = 200;
    response.write(parsedDSUContent);
    response.end();
}

function getFilePathFromRequest(request) {
    const {url} = request;
    let filePathStartIndex = url.indexOf(VERSIONLESS_DSU_PATH_PREFIX);
    if(filePathStartIndex === -1) {
        return null;
    }

    filePathStartIndex += VERSIONLESS_DSU_PATH_PREFIX.length;
    let filePath = url.substring(filePathStartIndex);

    // encode filePath in order to escape special characters
    const pskcrypto = require("pskcrypto");
    filePath = pskcrypto.pskBase58Encode(filePath);

    return filePath;
}

async function handleGetVersionlessDSURequest(request, response) {
    const filePath = getFilePathFromRequest(request);
    if(!filePath) {
        logger.error("[VersionlessDSU] FilePath not specified");
        response.statusCode = 400;
        return response.end();
    }
    const versionlessDSUFilePath = path.join(versionlessDSUFolderPath, filePath);

    const fs = require("fs");
    try {
        const fileContent = await $$.promisify(fs.readFile)(versionlessDSUFilePath);
        logger.debug(`[VersionlessDSU] Reading existing versionlessDSU from ${versionlessDSUFilePath}`);
        response.setHeader('content-type', "application/octet-stream"); // required in order for opendsu http fetch to properly work
        return sendVersionlessDSUContent(fileContent, response);
    } catch (error) {
        logger.error(`[VersionlessDSU] Failed to read/parse versionlessDSU from ${versionlessDSUFilePath}`, error);
        response.statusCode = 500;
        response.end();
    }
}

async function handlePutVersionlessDSURequest(request, response) {
    const filePath = getFilePathFromRequest(request);
    if(!filePath) {
        logger.error("[VersionlessDSU] FilePath not specified");
        response.statusCode = 400;
        return response.end();
    }

    const versionlessDSUFilePath = path.join(versionlessDSUFolderPath, filePath);

    const dsu = request.body;
    if (!dsu || typeof dsu !== "object") {
        logger.error("[VersionlessDSU] Required DSU content body not present");
        response.statusCode = 400;
        response.end();
    }

    try {
        logger.debug(`[VersionlessDSU] Writing versionlessDSU to ${versionlessDSUFilePath}`);
        await $$.promisify(fs.writeFile)(versionlessDSUFilePath, dsu);
        response.statusCode = 200;
        response.end();
    } catch (error) {
        logger.error(`[VersionlessDSU] Failed to write DSU content to file ${versionlessDSUFilePath}: (${dsu})`, error);
        response.statusCode = 500;
        response.end();
    }
}

module.exports = {
    init,
    handleGetVersionlessDSURequest,
    handlePutVersionlessDSURequest,
};
