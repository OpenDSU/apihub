const path = require("path");
const fs = require("fs");
const config = require("../../http-wrapper/config");
const openDSU = require("opendsu");
const crypto = openDSU.loadAPI("crypto");
const logger = $$.getLogger("controller", "apihub/versionlessDSU");

let versionlessDSUFolderPath;

const VERSIONLESS_DSU_PATH_PREFIX = "/versionlessdsu/";

async function init(server) {
    logger.debug(`[VersionlessDSU] Registering VersionlessDSU component`);
    versionlessDSUFolderPath = path.join(server.rootFolder, config.getConfig("externalStorage"), "versionlessdsu");
    logger.debug(`[VersionlessDSU] Ensuring VersionlessDSU folder (${versionlessDSUFolderPath}) is created`);
    try {
        await $$.promisify(fs.mkdir)(versionlessDSUFolderPath, {recursive: true});
    } catch (error) {
        logger.error("[VersionlessDSU] Failed to create VersionlessDSU folder", error);
    }
}

function sendVersionlessDSUContent(parsedDSUContent, response) {
    //generic content type header for snyk identified vulnerability
    response.setHeader('Content-Type', 'application/octet-stream');
    response.statusCode = 200;
    response.write(parsedDSUContent);
    response.end();
}

function getFilePathFromRequest(request) {
    const {url} = request;
    let filePathStartIndex = url.indexOf(VERSIONLESS_DSU_PATH_PREFIX);
    if (filePathStartIndex === -1) {
        return null;
    }

    filePathStartIndex += VERSIONLESS_DSU_PATH_PREFIX.length;
    let filePath = url.substring(filePathStartIndex);

    const filePathHash = crypto.sha256(filePath);
    return path.join(versionlessDSUFolderPath, filePathHash.substring(0, 3), filePathHash);
}

async function handleGetVersionlessDSURequest(request, response) {
    const filePath = getFilePathFromRequest(request);
    if (!filePath) {
        logger.error("[VersionlessDSU] FilePath not specified");
        response.statusCode = 400;
        return response.end();
    }

    const fs = require("fs");
    try {
        let resolvedFilePath = path.resolve(filePath);
        if (resolvedFilePath.indexOf(versionlessDSUFolderPath) === -1) {
            throw Error("Trying to read outside of VersionLess storage folder");
        }

        try {
            await $$.promisify(fs.access)(filePath, fs.constants.F_OK);
        } catch (err) {
            logger.info(`[VersionlessDSU] Unable to locate storage file ${filePath}`, err);
            response.statusCode = 404;
            response.end();
            return;
        }

        const fileContent = await $$.promisify(fs.readFile)(filePath);
        logger.debug(`[VersionlessDSU] Reading existing versionlessDSU from ${filePath}`);
        response.setHeader('content-type', "application/octet-stream"); // required in order for opendsu http fetch to properly work
        return sendVersionlessDSUContent(fileContent, response);
    } catch (error) {
        logger.error(`[VersionlessDSU] Failed to read/parse versionlessDSU from ${filePath}`, error);
        response.statusCode = 500;
        response.end();
    }
}

async function handlePutVersionlessDSURequest(request, response) {
    const filePath = getFilePathFromRequest(request);
    if (!filePath) {
        logger.error("[VersionlessDSU] FilePath not specified");
        response.statusCode = 400;
        return response.end();
    }

    const dsu = request.body;
    if (!dsu || typeof dsu !== "object") {
        logger.error("[VersionlessDSU] Required DSU content body not present");
        response.statusCode = 400;
        response.end();
    }

    try {
        await $$.promisify(fs.mkdir)(path.dirname(filePath), {recursive: true});
        logger.debug(`[VersionlessDSU] Writing versionlessDSU to ${filePath}`);
        let resolvedFilePath = path.resolve(filePath);
        if (resolvedFilePath.indexOf(versionlessDSUFolderPath) === -1) {
            throw Error("Trying to write outside of VersionLess storage folder");
        }
        await $$.promisify(fs.writeFile)(filePath, dsu);
        response.statusCode = 200;
        response.end();
    } catch (error) {
        logger.error(`[VersionlessDSU] Failed to write DSU content to file ${filePath}: (${dsu})`, error);
        response.statusCode = 500;
        response.end();
    }
}

module.exports = {
    init,
    handleGetVersionlessDSURequest,
    handlePutVersionlessDSURequest,
};
