const path = require("path");
const fs = require("fs");
const config = require("../../http-wrapper/config");
const {parseCookies, stringifyCookies} = require("../../http-wrapper/utils/cookie-utils");

const logger = $$.getLogger("controller", "apihub/mainDSU");

const MAIN_DSU_VALUE_COOKIE_NAME = "MAIN-DSU-VALUE";
const MAIN_DSU_VALUE_COOKIE_DEFAULT = "default";

// keep already loaded main DSUs KeySSI
const cachedMainDSUSeedSSIs = {};

let rootFolderPath;
let mainDSUSeedSSIFolderPath;

async function init(server) {
    logger.debug(`[MainDSU] Registering MainDSU component`);
    rootFolderPath = server.rootFolder;
    mainDSUSeedSSIFolderPath = path.join(server.rootFolder, config.getConfig("externalStorage"), "maindsu");
    logger.debug(`[MainDSU] Ensuring MainDSU seedSSI folder (${mainDSUSeedSSIFolderPath}) is created`);
    try {
        await $$.promisify(fs.mkdir)(mainDSUSeedSSIFolderPath, {recursive: true});
    } catch (error) {
        logger.error("[MainDSU] Failed to create MainDSU seedSSI folder", error);
    }
}

function sendMainDSUSeedSSI(mainDSUFileName, response) {
    response.statusCode = 200;
    response.write(cachedMainDSUSeedSSIs[mainDSUFileName].getIdentifier());
    response.end();
}

function getMainDSUFileNameForRequest(request) {
    const cookies = request.headers ? parseCookies(request.headers.cookie) : {};
    const valueCookie = cookies[MAIN_DSU_VALUE_COOKIE_NAME];
    if (valueCookie) {
        const crypto = require("pskcrypto");
        // we need to ensure some filename limit due to some OS filename size restrictions
        const valueCookieHash = crypto.pskHash(valueCookie, "hex");
        return valueCookieHash;
    }
    return MAIN_DSU_VALUE_COOKIE_DEFAULT;
}

async function handleSetSSIForMainDSUCookie(request, response) {
    const {value} = request.body;

    if (value == null) {
        logger.error("Required value body field not present");
        response.statusCode = 400;
        response.end();
    }

    const cookie = stringifyCookies({
        name: MAIN_DSU_VALUE_COOKIE_NAME,
        value: value,
        httpOnly: true,
        path: "/",
        maxAge: 2147483647, // (2038-01-19 04:14:07) maximum value to avoid integer overflow on older browsers
    });
    response.setHeader("Set-Cookie", cookie);
    response.statusCode = 200;
    response.end();
}

async function handleDefaultMainDSURequest(request, response) {
    const mainDSUFileName = getMainDSUFileNameForRequest(request);

    if (cachedMainDSUSeedSSIs[mainDSUFileName]) {
        return sendMainDSUSeedSSI(mainDSUFileName, response);
    }

    const mainDSUSeedSSIFilePath = path.join(mainDSUSeedSSIFolderPath, mainDSUFileName);

    const fs = require("fs");
    const keySSISpace = require("opendsu").loadApi("keyssi");
    const resolver = require("opendsu").loadApi("resolver");
    let mainDSUSeedSSI;
    let mainDSUAnchorId;
    try {
        const fileContent = await $$.promisify(fs.readFile)(mainDSUSeedSSIFilePath, {encoding: "utf-8"});
        mainDSUSeedSSI = keySSISpace.parse(fileContent);
        cachedMainDSUSeedSSIs[mainDSUFileName] = mainDSUSeedSSI;
        mainDSUAnchorId = await $$.promisify(mainDSUSeedSSI.getAnchorId)();
        logger.debug(`[MainDSU] Read existing mainDSU from ${mainDSUSeedSSIFilePath}: ${mainDSUAnchorId}`);
        return sendMainDSUSeedSSI(mainDSUFileName, response);
    } catch (error) {
        logger.error(`[MainDSU] Failed to read/parse keySSI from ${mainDSUSeedSSIFilePath}. Generating new keySSI...`, error);
    }

    try {
        const environmentJsPath = require("path").join(rootFolderPath, "environment.js");
        logger.debug(`[MainDSU] Loading environment.js config file from: ${environmentJsPath}`);

        const environmentConfig = require(environmentJsPath);

        const seedSSI = await $$.promisify(keySSISpace.createSeedSSI)(environmentConfig.vaultDomain);
        const mainDSU = await $$.promisify(resolver.createDSUForExistingSSI)(seedSSI);

        logger.debug(`[MainDSU] Settings config for seed ${await $$.promisify(seedSSI.getAnchorId)()}`, environmentConfig);
        let batchId = await $$.promisify(mainDSU.safeBeginBatch)();
        await $$.promisify(mainDSU.writeFile)("/environment.json", JSON.stringify(environmentConfig));

        mainDSUSeedSSI = seedSSI;
        cachedMainDSUSeedSSIs[mainDSUFileName] = mainDSUSeedSSI;
        mainDSUAnchorId = await $$.promisify(mainDSUSeedSSI.getAnchorId)();
        logger.debug("[MainDSU] Generated mainDSUSeedSSI: ", mainDSUAnchorId, mainDSUSeedSSI);

        logger.debug(`[MainDSU] Writing generated mainDSU to ${mainDSUSeedSSIFilePath}: ${mainDSUAnchorId}`);
        await $$.promisify(fs.writeFile)(mainDSUSeedSSIFilePath, mainDSUSeedSSI.getIdentifier(), "utf-8");
        await $$.promisify(mainDSU.commitBatch(batchId));
        sendMainDSUSeedSSI(mainDSUFileName, response);
    } catch (error) {
        logger.error("[MainDSU] Failed to create seedSSI", error);
        response.statusCode = 500;
        response.setHeader("Content-Type", "text/html");
        response.end("Failed to create seedSSI");
    }
}

module.exports = {
    init,
    handleSetSSIForMainDSUCookie,
    handleDefaultMainDSURequest,
};
