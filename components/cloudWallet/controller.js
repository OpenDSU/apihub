const http = require("http");
const crypto = require("crypto");
const worker_threads = "worker_threads";
const {Worker} = require(worker_threads);
const config = require("../../config");
const {parseCookies, stringifyCookies} = require("../../utils/cookie-utils");
const path = require("swarmutils").path;
const logger = $$.getLogger("CloudWallet", "apihub/cloudWallet");
let dsuBootPath;
const dsuWorkers = {};

let cacheContainerPath;

const SSAPP_TOKEN_COOKIE_NAME = "SSAPP-TOKEN";

const getElapsedTime = (timer) => {
    const elapsed = process.hrtime(timer)[1] / 1000000;
    return `${elapsed.toFixed(3)} ms`;
};

const INVALID_DSU_HTML_RESPONSE = `
    <html>
    <body>
        <p>
            The application has encountered an unexpected error. <br/>
            If you have network issues please use the following to refresh the application.
        </p>
        <button id="refresh">Refresh</button>
        <script>
            document.getElementById("refresh").addEventListener("click", function() {
                window.top.location.reload();
            });
        </script>
    </body>
    </html>
`;

function addDsuWorker(seed, walletAnchorId, cookie) {
    const workerStartTime = process.hrtime();
    const dsuWorker = {
        port: null,
        authorizationKey: null,
        resolver: new Promise((resolve, reject) => {
            crypto.randomBytes(64, (err, randomBuffer) => {
                if (err) {
                    logger.error("Error while generating worker authorizationKey", err);
                    return reject(err);
                }

                const authorizationKey = randomBuffer.toString("hex");
                dsuWorker.authorizationKey = authorizationKey;
                logger.debug(`Starting worker for handling seed ${seed}`);
                const worker = new Worker(dsuBootPath, {
                    workerData: {
                        seed,
                        authorizationKey,
                        cookie,
                        cacheContainerPath,
                        walletAnchorId
                    },
                });

                worker.on("message", (message) => {
                    if (message.error) {
                        dsuWorkers[seed] = null;
                        return reject(message.error);
                    }
                    if (message.port) {
                        logger.debug(
                            `Running worker on PORT ${message.port} for seed ${seed}. Startup took ${getElapsedTime(
                                workerStartTime
                            )}`
                        );
                        dsuWorker.port = message.port;
                        resolve(worker);
                    }
                });
                worker.on("error", (error) => {
                    logger.error("worker error", error);
                });
                worker.on("exit", (code) => {
                    if (code !== 0) {
                        logger.debug(`Worker stopped with exit code ${code}`);
                        // remove the worker from list in order to be recreated when needed
                        delete dsuWorkers[seed];
                    }
                });

                dsuWorker.terminate = function () {
                    worker.terminate();
                };
            });
        }),
    };
    dsuWorkers[seed] = dsuWorker;
    return dsuWorker;
}

function forwardRequestToWorker(dsuWorker, req, res) {
    const method = req.method;
    const { keySSI } = req.params;
    let requestedPath = req.url.substr(req.url.indexOf(keySSI) + keySSI.length);

    if (!requestedPath) {
        requestedPath = "/";
    }

    if (!requestedPath.startsWith("/")) {
        requestedPath = `/${requestedPath}`;
    }

    // Validate the port is a number and falls within an allowed range (for example, 1024 to 65535)
    const port = parseInt(dsuWorker.port, 10);
    if (isNaN(port) || port < 1024 || port > 65535) {
        res.statusCode = 400;
        res.end("Invalid worker port");
        return;
    }

    // Validate and sanitize the requested path
    if (!/^\/[a-zA-Z0-9\-\/]*$/.test(requestedPath)) {
        res.statusCode = 400;
        res.end("Invalid request path");
        return;
    }

    const options = {
        hostname: "127.0.0.1", // Explicitly restricts to localhost
        port: port,
        path: requestedPath,
        method: method,
        headers: {
            authorization: dsuWorker.authorizationKey,
        },
    };

    // Forward only certain headers to prevent SSRF and leaks
    if (req.headers.cookie) {
        options.headers.cookie = req.headers.cookie;
    }

    if (req.headers["content-type"]) {
        options.headers["content-type"] = req.headers["content-type"];
    }

    const workerRequest = http.request(options, (response) => {
        const { statusCode, headers } = response;
        res.statusCode = statusCode;
        const contentType = headers ? headers["content-type"] : null;
        res.setHeader("Content-Type", contentType || "text/html");

        if (statusCode < 200 || statusCode >= 300) {
            return res.end();
        }

        let data = [];
        response.on("data", (chunk) => {
            data.push(chunk);
        });

        response.on("end", () => {
            try {
                const bodyContent = $$.Buffer.concat(data);
                res.statusCode = statusCode;
                res.end(bodyContent);
            } catch (err) {
                logger.error("Worker response error", err);
                res.statusCode = 500;
                res.end();
            }
        });
    });

    workerRequest.on("error", (err) => {
        logger.error("Worker request error", err);
        res.statusCode = 500;
        res.end();
    });

    // Handle POST or PUT request body forwarding
    if (method === "POST" || method === "PUT") {
        let data = [];
        req.on("data", (chunk) => {
            data.push(chunk);
        });

        req.on("end", () => {
            try {
                const bodyContent = $$.Buffer.concat(data);
                workerRequest.write(bodyContent);
                workerRequest.end();
            } catch (err) {
                logger.error("Worker request body error", err);
                res.statusCode = 500;
                res.end();
            }
        });
        return;
    }
    workerRequest.end();
}

function init(server) {
    logger.debug(`Registering CloudWallet component`);

    dsuBootPath = config.getConfig("componentsConfig", "cloudWallet", "dsuBootPath");

    if (dsuBootPath.startsWith(".")) {
        dsuBootPath = path.resolve(path.join(process.env.PSK_ROOT_INSTALATION_FOLDER, dsuBootPath));
    }

    logger.debug(`Using boot script for worker: ${dsuBootPath}`);

    cacheContainerPath = require("path").join(server.rootFolder, config.getConfig("externalStorage"), `cache`);

    //if a listening event is fired from this point on...
    //it means that a restart was triggered
    server.on("listening", () => {
        logger.debug(`Restarting process in progress...`);
        logger.debug(`Stopping a number of ${Object.keys(dsuWorkers).length} thread workers`);
        for (let seed in dsuWorkers) {
            let worker = dsuWorkers[seed];
            if (worker && worker.terminate) {
                worker.terminate();
            }
        }
    });
}

function handleCloudWalletRequest(request, response) {
    // use the keySSI set from the token middleware first (if present)
    const keySSI = request.keySSI || request.params.keySSI;

    let dsuWorker = dsuWorkers[keySSI];
    if (!dsuWorker) {
        dsuWorker = addDsuWorker(keySSI, request.walletAnchorId, request.headers.cookie);
    }

    dsuWorker.resolver
        .then(() => {
            forwardRequestToWorker(dsuWorker, request, response);
        })
        .catch((error) => {
            logger.error("worker resolver error", error);
            response.setHeader("Content-Type", "text/html");
            response.statusCode = 400;
            response.end(INVALID_DSU_HTML_RESPONSE);
        });
}

function getSSappTokenCookieValue(request) {
    const cookies = parseCookies(request.headers.cookie);
    let ssappTokenCookieValue = {};
    if (cookies[SSAPP_TOKEN_COOKIE_NAME]) {
        try {
            ssappTokenCookieValue = JSON.parse(cookies[SSAPP_TOKEN_COOKIE_NAME]);
            if (typeof ssappTokenCookieValue !== "object") {
                logger.error(
                    `Detected invalid ${SSAPP_TOKEN_COOKIE_NAME} cookie value (${cookies[SSAPP_TOKEN_COOKIE_NAME]}) parsed content`,
                    ssappTokenCookieValue
                );
                ssappTokenCookieValue = {};
            }
        } catch (error) {
            logger.error(`Failed to parse ${SSAPP_TOKEN_COOKIE_NAME} cookie value (${cookies[SSAPP_TOKEN_COOKIE_NAME]})`, error);
            // reset cookie value since it has an invalid JSON content
            ssappTokenCookieValue = {};
        }
    }
    return ssappTokenCookieValue;
}

function setRequestKeySSIFromSSAppToken(request, response, next) {
    const {keySSI} = request.params;
    const ssappTokenCookieValue = getSSappTokenCookieValue(request);
    if (ssappTokenCookieValue[keySSI]) {
        logger.info(`Found match for walletAnchorId ${keySSI}`);
        request.keySSI = ssappTokenCookieValue[keySSI];
        request.walletAnchorId = keySSI;
    }
    next();
}

function handleSetSSAppTokenRequest(request, response) {
    const {walletAnchorId} = request.params;
    const {sReadSSI} = request.body;

    if (!sReadSSI) {
        logger.error("Required sReadSSI body field not present");
        response.statusCode = 400;
        response.end();
    }

    const ssappTokenCookieValue = getSSappTokenCookieValue(request);
    ssappTokenCookieValue[walletAnchorId] = sReadSSI;

    const updatedTokenCookie = stringifyCookies({
        name: SSAPP_TOKEN_COOKIE_NAME,
        value: JSON.stringify(ssappTokenCookieValue),
        httpOnly: true,
        secure: true,
        path: "/",
        maxAge: 2147483647, // (2038-01-19 04:14:07) maximum value to avoid integer overflow on older browsers
    });
    response.setHeader("Set-Cookie", updatedTokenCookie);
    response.statusCode = 200;
    response.end();
}

module.exports = {
    init,
    handleCloudWalletRequest,
    setRequestKeySSIFromSSAppToken,
    handleSetSSAppTokenRequest,
};
