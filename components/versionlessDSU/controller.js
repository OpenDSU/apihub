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

function getAnchorIdFromRequest(request) {
    const {url} = request;
    let anchorIdStartIndex = url.indexOf(VERSIONLESS_DSU_PATH_PREFIX);
    if(anchorIdStartIndex === -1) {
        return null;
    }

    anchorIdStartIndex += VERSIONLESS_DSU_PATH_PREFIX.length;
    let anchorId = url.substring(anchorIdStartIndex);

    // encode anchorId in order to escape special characters
    const pskcrypto = require("pskcrypto");
    anchorId = pskcrypto.pskBase58Encode(anchorId);

    return anchorId;
}

async function handleGetVersionlessDSURequest(request, response) {
    const anchorId = getAnchorIdFromRequest(request);
    if(!anchorId) {
        logger.error("[VersionlessDSU] AnchorId not specified");
        response.statusCode = 400;
        return response.end();
    }
    const versionlessDSUFilePath = path.join(versionlessDSUFolderPath, anchorId);

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
    const anchorId = getAnchorIdFromRequest(request);
    if(!anchorId) {
        logger.error("[VersionlessDSU] AnchorId not specified");
        response.statusCode = 400;
        return response.end();
    }

    const versionlessDSUFilePath = path.join(versionlessDSUFolderPath, anchorId);

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
