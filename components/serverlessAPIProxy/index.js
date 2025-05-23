const httpWrapper = require("../../http-wrapper/src/httpUtils");
const ProcessManager = require("../../serverlessAPI/ProcessManager");

const createServerlessAPIProxy = async (server) => {
    const urlPrefix = '/proxy';
    const processManager = new ProcessManager();

    function forwardRequest(serverlessApiAddress, data, callback, method = 'PUT') {
        if (typeof data === 'function') {
            callback = data;
            data = null;
        }
        let protocol = serverlessApiAddress.indexOf("https://") === 0 ? "https" : "http";
        protocol = require(protocol);

        let request = protocol.request(serverlessApiAddress, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        }, (resp) => {
            resp.body = [];

            // A chunk of data has been received.
            resp.on("data", (chunk) => {
                resp.body.push(chunk);
            });

            // The whole response has been received. Print out the result.
            resp.on("end", () => {
                let body;
                try {
                    body = JSON.parse(Buffer.concat(resp.body).toString());
                } catch (e) {
                    return callback(e);
                }
                callback(undefined, body);
            });
        });

        request.on("error", callback);

        if (data) {
            request.write(data);
        }

        request.end();
    }

    server.put(`${urlPrefix}/executeCommand/:serverlessId`, (req, res, next) => {
        if (req.body) {
            return next();
        }
        httpWrapper.bodyParser(req, res, next);
    });

    server.put(`${urlPrefix}/executeCommand/:serverlessId`, function (req, res) {
        const serverlessId = req.params.serverlessId;
        const processInfo = processManager.getProcessInfo(serverlessId);

        if (!processInfo) {
            res.statusCode = 404;
            res.write("Serverless process not found or not ready");
            return res.end();
        }

        const serverlessApiUrl = processInfo.url;
        forwardRequest(`${serverlessApiUrl}/executeCommand`, req.body, (err, response) => {
            if (err) {
                res.statusCode = 500;
                console.error(`Error while executing command ${JSON.parse(req.body).name}`, err);
                const errorResponse = {
                    statusCode: 500,
                    result: {
                        message: err.message,
                        stack: err.stack
                    }
                };
                res.write(JSON.stringify(errorResponse));
                return res.end();
            }

            // Use the statusCode from response body if available (this is what the serverless process wants to communicate)
            const statusCode = (response && typeof response === 'object' && response.statusCode) ? response.statusCode : 200;
            res.statusCode = statusCode;
            if (statusCode === 500) {
                console.error(`Error while executing command ${JSON.parse(req.body).name}`, response);
            }
            res.write(JSON.stringify(response));
            res.end();
        });
    });

    server.put(`${urlPrefix}/restart/:serverlessId`, async (req, res) => {
        const serverlessId = req.params.serverlessId;
        const processInfo = processManager.getProcessInfo(serverlessId);

        if (!processInfo) {
            res.statusCode = 404;
            res.write("Serverless process not found");
            return res.end();
        }

        let envVars = {};
        if (req.body) {
            try {
                let bodyContent = req.body;
                if (Buffer.isBuffer(bodyContent)) {
                    bodyContent = bodyContent.toString();
                }
                const parsedBody = (typeof bodyContent === 'string' && bodyContent.length > 0) ? JSON.parse(bodyContent) : bodyContent;

                if (typeof parsedBody === 'object' && parsedBody !== null) {
                    envVars = parsedBody;
                    console.log(`Received env vars from request body for ${serverlessId}.`);
                } else {
                    console.warn(`Request body for ${serverlessId} is not a valid JSON object for env vars, using secrets or empty.`);
                }
            } catch (e) {
                console.warn(`Failed to parse request body for env vars for ${serverlessId}, using secrets or empty:`, e);
            }
        }

        if (Object.keys(envVars).length === 0) {
            envVars = await processManager._loadEnvironmentFromSecrets(serverlessId, server.rootFolder);
        }

        try {
            const newProcessInfo = await processManager.restartProcess(serverlessId, envVars);

            if (!res.headersSent) {
                res.statusCode = 200;
                res.write(JSON.stringify({
                    statusCode: 200,
                    message: `Serverless process ${serverlessId} restarted successfully with new environment.`,
                    newUrl: newProcessInfo.url
                }));
                res.end();
            }
        } catch (err) {
            console.error(`Failed to restart serverless process ${serverlessId}:`, err.message);
            if (!res.headersSent) {
                res.statusCode = 500;
                res.write(JSON.stringify({
                    message: `Failed to restart serverless process ${serverlessId}.`,
                    error: err.message
                }));
                res.end();
            }
        }
    });

    server.get(`${urlPrefix}/ready/:serverlessId`, function (req, res) {
        const serverlessId = req.params.serverlessId;
        const processInfo = processManager.getProcessInfo(serverlessId);

        if (!processInfo) {
            res.statusCode = 404;
            res.write("Serverless process not found or not ready");
            return res.end();
        }

        if (processInfo.restarting) {
            res.statusCode = 200;
            res.write(JSON.stringify({
                statusCode: 200,
                result: 'not-ready'
            }));
            return res.end();
        }

        const serverlessApiUrl = processInfo.url;
        forwardRequest(`${serverlessApiUrl}/ready`, null, (err, response) => {
            if (err) {
                res.statusCode = 500;
                console.error("Error checking serverless process readiness", err);
                const errorResponse = {
                    statusCode: 500,
                    result: {
                        message: err.message,
                        stack: err.stack
                    }
                };
                res.write(JSON.stringify(errorResponse));
                return res.end();
            }

            // Use the statusCode from response body if available (this is what the serverless process wants to communicate)
            const statusCode = (response && typeof response === 'object' && response.statusCode) ? response.statusCode : 200;
            res.statusCode = statusCode;
            res.write(JSON.stringify(response));
            res.end();
        }, 'GET');
    });

    server.registerServerlessProcess = (serverlessId, processInfo) => {
        const processData = {
            process: processInfo.process,
            url: processInfo.url,
            config: processInfo.config || {},
            scriptPath: processInfo.scriptPath
        };

        if (!processData.config.id) {
            processData.config.id = serverlessId;
        }

        processManager.processes.set(serverlessId, {
            ...processData,
            id: serverlessId
        });

        processManager._setupPersistentHandlers(serverlessId, processData);
        console.log(`Registered serverless process ${serverlessId} with PID ${processInfo.process.pid} at URL ${processInfo.url}`);
    };

    server.processManager = processManager;

    return server;
};

module.exports = createServerlessAPIProxy;