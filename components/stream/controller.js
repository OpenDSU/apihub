const syndicate = require("syndicate");
const logger = $$.getLogger("stream", "apihub/stream");

const dsuWorkers = {};

function getNodeWorkerBootScript() {
    const openDSUScriptPath = global.bundlePaths.openDSU.replace(/\\/g, "\\\\").replace(".js", "");
    return `
        require("${openDSUScriptPath}");
        (${require("./worker-script").toString()})();
    `;
}

async function handleCreateWallet(request, response) {
    try {
        const { domain, userId } = request.params;
        const isValidDomain = require("swarmutils").isValidDomain;
        if (!isValidDomain(domain)) {
            logger.error("[Stream] Domain validation failed", domain);
            response.statusCode = 400;
            return response.end("Invalid domain");
        }

        // Basic alphanumeric validation for userId
        if (!userId || !/^[a-zA-Z0-9]+$|^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(userId)) {
            logger.error("[Stream] userId validation failed", userId);
            response.statusCode = 400;
            return response.end("Invalid user ID");
        }

        const keySSISpace = require("opendsu").loadApi("keyssi");
        const resolver = require("opendsu").loadApi("resolver");
        const crypto = require("pskcrypto");
        const credential = crypto.randomBytes(64).toString("hex");

        const walletSSI = keySSISpace.createTemplateWalletSSI(domain, credential);
        const seedSSI = await $$.promisify(keySSISpace.createSeedSSI)(domain);

        const walletDSU = await $$.promisify(resolver.createDSUForExistingSSI)(walletSSI, { dsuTypeSSI: seedSSI });
        const writableDSU = walletDSU.getWritableDSU();

        const enclaveKeySSIObject = await $$.promisify(resolver.createSeedDSU)(domain);
        const enclaveKeySSI = await $$.promisify(enclaveKeySSIObject.getKeySSIAsString)();

        const sharedEnclaveKeySSIObject = await $$.promisify(resolver.createSeedDSU)(domain);
        const sharedEnclaveKeySSI = await $$.promisify(sharedEnclaveKeySSIObject.getKeySSIAsString)();

        const constants = require("opendsu").constants;
        const environmentConfig = {
            vaultDomain: domain,
            didDomain: domain,
            enclaveType: constants.ENCLAVE_TYPES.WALLET_DB_ENCLAVE,
            enclaveKeySSI,
            sharedEnclaveType: constants.ENCLAVE_TYPES.WALLET_DB_ENCLAVE,
            sharedEnclaveKeySSI,
        };

        await $$.promisify(writableDSU.writeFile)("/environment.json", JSON.stringify(environmentConfig));
        await $$.promisify(writableDSU.writeFile)("/metadata.json", JSON.stringify({ userId }));

        response.statusCode = 200;
        response.setHeader("Content-type", "text/plain");
        return response.end(walletSSI.getIdentifier());
    } catch (error) {
        logger.error("[Stream] Error", error);
        response.statusCode = 500;
        return response.end("Failed to create wallet");
    }
}

async function handleStreamRequest(request, response) {
    const { keySSI } = request.params;

    // Validate keySSI to allow only Base64 or Base58 characters
    const keySSIPattern = /^[A-Za-z0-9+/=]*$|^[A-HJ-NP-Za-km-z1-9]*$/;
    if (!keySSIPattern.test(keySSI)) {
        response.statusCode = 400;
        return response.end("Invalid keySSI");
    }

    let requestedPath = request.url.substr(request.url.indexOf(keySSI) + keySSI.length);

    // Sanitize requestedPath
    if (!requestedPath) {
        requestedPath = "/";
    }
    if (!requestedPath.startsWith("/")) {
        requestedPath = `/${requestedPath}`;
    }

    // Allow requestedPath to contain alphanumeric characters, /, _, -, ., and spaces
    const pathPattern = /^[a-zA-Z0-9/_\-\. ]*$/;
    if (!pathPattern.test(requestedPath)) {
        response.statusCode = 400;
        return response.end("Invalid path");
    }

    let range = request.headers.range;
    if (!range || !/^bytes=\d*-\d*$/.test(range)) {
        response.statusCode = 400;
        return response.end("Requires valid Range header");
    }

    // Default chunk size to use if `end` is not provided
    const CHUNK_SIZE = 1024 * 1024; // 1 MB
    let start, end;

    // Extract the range values
    range = range.split("=")[1]; // Remove 'bytes=' prefix
    if (range.indexOf("-") !== -1) {
        let parts = range.split("-");
        start = parseInt(parts[0], 10);
        end = parts[1] ? parseInt(parts[1], 10) : start + CHUNK_SIZE;
    } else {
        start = parseInt(range, 10);
        end = start + CHUNK_SIZE;
    }

    // Validate the range values
    if (isNaN(start) || start < 0 || (end && isNaN(end))) {
        response.statusCode = 400;
        return response.end("Invalid range values");
    }

    if (end < start) {
        response.statusCode = 400;
        return response.end("Invalid range: end must be greater than start");
    }

    let dsuWorker = dsuWorkers[keySSI];
    if (!dsuWorker) {
        dsuWorker = syndicate.createWorkerPool({
            bootScript: getNodeWorkerBootScript(),
            maximumNumberOfWorkers: 1,
            workerOptions: {
                eval: true,
                workerData: {
                    keySSI,
                },
            },
        });
        dsuWorkers[keySSI] = dsuWorker;
    }

    const sendTaskToWorker = (task, callback) => {
        dsuWorker.addTask(task, (err, message) => {
            if (err) {
                return callback(err);
            }

            let { error, result } = typeof Event !== "undefined" && message instanceof Event ? message.data : message;

            if (error) {
                return callback(error);
            }

            if (result && result.buffer && result.buffer instanceof Uint8Array) {
                result.buffer = $$.Buffer.from(result.buffer);
            }

            callback(error, result);
        });
    };

    const task = {
        requestedPath,
        range,
    };

    try {
        const taskResult = await $$.promisify(sendTaskToWorker)(task);
        response.writeHead(206, taskResult.headers);
        response.end(taskResult.buffer);
    } catch (error) {
        logger.error("[Stream] error", error);
        response.statusCode = 500;
        return response.end("Failed to handle stream");
    }
}

module.exports = {
    handleCreateWallet,
    handleStreamRequest,
};
