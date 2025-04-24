const httpWrapper = require("../../http-wrapper/src/httpUtils");
const { fork } = require('child_process');

const createServerlessAPIProxy = async (server) => {
    const urlPrefix = '/proxy'
    const registeredServerlessProcesses = {};

    function _forkServerlessProcess(scriptPath, config, envVars) {
        return new Promise((resolve, reject) => {
            const forkOptions = {
                env: { ...process.env, ...envVars }
            };
    
            console.log(`Forking process: ${scriptPath} with env keys: ${Object.keys(envVars).join(', ')}`);
            const newProcess = fork(scriptPath, [], forkOptions);
            let isReady = false;
    
            // Setup logging immediately
            const serverlessId = config.id || 'NEW';
            if (newProcess.stdout) {
                 newProcess.stdout.on('data', (data) => {
                     console.log(`[${serverlessId} PID:${newProcess.pid} STDOUT]: ${data.toString().trim()}`);
                 });
            } else {
                console.warn(`[${serverlessId} PID:${newProcess.pid}] Forked process object is missing stdout stream!`);
            }
            if (newProcess.stderr) {
                 newProcess.stderr.on('data', (data) => {
                     console.error(`[${serverlessId} PID:${newProcess.pid} STDERR]: ${data.toString().trim()}`);
                 });
            } else {
                 console.warn(`[${serverlessId} PID:${newProcess.pid}] Forked process object is missing stderr stream!`);
            }
    
    
            const readyTimeout = setTimeout(() => {
                 if (!isReady && newProcess && !newProcess.killed) {
                    console.error(`Timeout waiting for new serverless process ${serverlessId} (PID: ${newProcess.pid}) to become ready. Killing process.`);
                    newProcess.kill('SIGTERM');
                 }
                 // Reject regardless of kill outcome if timeout occurs before ready
                 reject(new Error(`Timeout waiting for serverless process ${serverlessId} to become ready.`));
            }, 30000); // 30 seconds timeout
    
            const cleanupTimeout = () => clearTimeout(readyTimeout);
    
            // Handle messages from child process
            newProcess.on('message', (message) => {
                if (message.type === 'ready') {
                    cleanupTimeout();
                    isReady = true;
                    console.log(`New serverless process ${serverlessId} (PID: ${newProcess.pid}) reported ready at ${message.url}`);
                    resolve({ process: newProcess, url: message.url, port: message.port });
                } else if (message.type === 'error') {
                    cleanupTimeout();
                    console.error(`New serverless process ${serverlessId} (PID: ${newProcess.pid}) reported an error during startup:`, message.error);
                    if (newProcess && !newProcess.killed) {
                         newProcess.kill();
                    }
                    reject(new Error(message.error));
                }
            });
    
            newProcess.on('error', (err) => {
                cleanupTimeout();
                console.error(`Error spawning or communicating with new serverless process ${serverlessId} (PID: ${newProcess.pid || 'N/A'}):`, err);
                 if (newProcess && !newProcess.killed) {
                     newProcess.kill(); // Ensure cleanup on spawn error
                 }
                reject(err);
            });
    
             // Handle child process exit before ready
             newProcess.on('exit', (code, signal) => {
                 cleanupTimeout();
                 if (!isReady) {
                     // Only reject if we haven't already resolved (i.e., 'ready' message wasn't received)
                     console.error(`Child process ${serverlessId} (PID: ${newProcess.pid || 'N/A'}) exited prematurely with code ${code}, signal ${signal}.`);
                     reject(new Error(`Child process ${serverlessId} exited prematurely with code ${code}, signal ${signal}.`));
                 }
                 // If already ready, the persistent exit handler (added later) will manage cleanup.
             });
    
            // Start the server by sending the configuration
            console.log(`Sending 'start' command to new serverless process ${serverlessId} (PID: ${newProcess.pid})`);
            newProcess.send({type: 'start', config});
        });
    }

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

    server.put(`${urlPrefix}/executeCommand/:serverlessId`, (req,res, next)=>{
        if(req.body){
            return next();
        }
        httpWrapper.bodyParser(req, res, next);
    });

    server.put(`${urlPrefix}/executeCommand/:serverlessId`, function (req, res) {
        const serverlessId = req.params.serverlessId;
        if (!registeredServerlessProcesses[serverlessId]) {
            res.statusCode = 404;
            res.write("Serverless process not found or not ready");
            return res.end();
        }

        const serverlessApiUrl = registeredServerlessProcesses[serverlessId].url;
        forwardRequest(`${serverlessApiUrl}/executeCommand`, req.body, (err, response) => {
            if (err) {
                res.statusCode = 500;
                console.error(`Error while executing command ${JSON.parse(req.body).name}`, err);
                res.write(err.message);
                return res.end();
            }

            res.statusCode = response.statusCode;
            if(response.statusCode === 500) {
                console.error(`Error while executing command ${JSON.parse(req.body).name}`, response);
            }
            res.write(JSON.stringify(response));
            res.end();
        });
    });

    server.put(`${urlPrefix}/setEnv/:serverlessId`, async (req, res) => {
        const serverlessId = req.params.serverlessId;
        const processInfo = registeredServerlessProcesses[serverlessId];

        if (!processInfo) {
            res.statusCode = 404;
            res.write("Serverless process not found");
            return res.end();
        }

        // Keep original config and scriptPath
        const { process: oldProcess, config, scriptPath } = processInfo;
        if (!config.id) {
            config.id = serverlessId;
        }

        // Determine environment variables
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
            console.log(`No env vars in request body for ${serverlessId}, trying secrets service.`);
            try {
                const apiHub = require('apihub');
                const secretsService = await apiHub.getSecretsServiceInstanceAsync(server.rootFolder);
                const secretsEnv = await secretsService.getSecretsAsync('env');
                 if (typeof secretsEnv === 'object' && secretsEnv !== null) {
                     envVars = secretsEnv;
                     console.log(`Loaded env vars from secrets service for ${serverlessId}.`);
                 } else {
                     console.log(`Environment variables from secrets service for ${serverlessId} were not an object, using empty env.`);
                     envVars = {};
                 }
            } catch (err) {
                console.log(`No environment variables found in secrets service for ${serverlessId}, continuing with empty env:`, err.message);
                envVars = {};
            }
        }

        // Kill the old process
        console.log(`Stopping old serverless process ${serverlessId} (PID: ${oldProcess ? oldProcess.pid : 'N/A'}) before restart.`);
        if (oldProcess && !oldProcess.killed) {
             // Remove listeners from old process to avoid logging/errors after kill command
             oldProcess.removeAllListeners();
             oldProcess.kill('SIGTERM');
             // Wait briefly for the process to exit
             await new Promise(resolve => setTimeout(resolve, 200));
        }
        // Clear the old registration immediately
        delete registeredServerlessProcesses[serverlessId];

        console.log(`Attempting to fork new serverless process ${serverlessId} with updated environment.`);

        try {
            // Use the new helper function to fork the process
            const { process: newProcess, url: newUrl } = await _forkServerlessProcess(scriptPath, config, envVars);

            console.log(`New serverless process ${serverlessId} (PID: ${newProcess.pid}) successfully started at ${newUrl}.`);

            // Register the new process information
            registeredServerlessProcesses[serverlessId] = {
                process: newProcess,
                config: config,
                scriptPath: scriptPath,
                url: newUrl
            };

            // Setup long-term exit/error handlers for cleanup *after* successful registration
            newProcess.on('exit', (code, signal) => {
                // Use a local variable for PID in case newProcess object becomes unavailable later
                const pid = newProcess.pid || 'N/A';
                console.warn(`Registered serverless process ${serverlessId} (PID: ${pid}) exited unexpectedly with code ${code}, signal ${signal}. Removing registration.`);
                // Check if the currently registered process for this ID is indeed the one that exited
                if (registeredServerlessProcesses[serverlessId] && registeredServerlessProcesses[serverlessId].process === newProcess) {
                     delete registeredServerlessProcesses[serverlessId];
                } else {
                     console.log(`Process ${serverlessId} (PID: ${pid}) exited, but was no longer the registered process.`);
                }
            });
            newProcess.on('error', (err) => {
                const pid = newProcess.pid || 'N/A';
                console.error(`Error from registered serverless process ${serverlessId} (PID: ${pid}):`, err);
                 if (registeredServerlessProcesses[serverlessId] && registeredServerlessProcesses[serverlessId].process === newProcess) {
                      console.log(`Removing registration for errored process ${serverlessId} (PID: ${pid})`);
                      delete registeredServerlessProcesses[serverlessId];
                 } else {
                      console.log(`Received error from process ${serverlessId} (PID: ${pid}), but it was no longer the registered process.`);
                 }
            });

             if (!res.headersSent) {
                  res.statusCode = 200;
                  res.write(JSON.stringify({ statusCode: 200, message: `Serverless process ${serverlessId} restarted successfully with new environment.`, newUrl: newUrl }));
                  res.end();
             }

        } catch (err) {
             console.error(`Failed to start new serverless process ${serverlessId} after restart attempt:`, err.message);
             if (!res.headersSent) {
                 res.statusCode = 500;
                 res.write(JSON.stringify({ message: `Failed to restart serverless process ${serverlessId}.`, error: err.message }));
                 res.end();
             }
        }
    });

    server.get(`${urlPrefix}/ready/:serverlessId`, function (req, res) {
        const serverlessId = req.params.serverlessId;
        if (!registeredServerlessProcesses[serverlessId]) {
            res.statusCode = 404;
            res.write("Serverless process not found or not ready");
            return res.end();
        }

        const serverlessApiUrl = registeredServerlessProcesses[serverlessId].url;
        forwardRequest(`${serverlessApiUrl}/ready`, null, (err, response) => {
            if (err) {
                res.statusCode = 500;
                console.error("Error checking serverless process readiness", err);
                res.write(err.message);
                return res.end();
            }

            res.statusCode = response.statusCode;
            res.write(JSON.stringify(response));
            res.end();
        }, 'GET');
    });

    server.registerServerlessProcess = (serverlessId, processInfo) => {
        const { process, config, scriptPath, url } = processInfo;
        console.log(`Registering serverless process ${serverlessId} with PID ${process.pid} at URL ${url}`);
        registeredServerlessProcesses[serverlessId] = { process, config, scriptPath, url };

         process.on('exit', (code, signal) => {
             console.warn(`Registered serverless process ${serverlessId} (PID: ${process.pid}) exited unexpectedly with code ${code}, signal ${signal}. Removing registration.`);
             if (registeredServerlessProcesses[serverlessId] && registeredServerlessProcesses[serverlessId].process === process) {
                  delete registeredServerlessProcesses[serverlessId];
             }
         });
          process.on('error', (err) => {
             console.error(`Error from registered serverless process ${serverlessId} (PID: ${process.pid}):`, err);
              if (registeredServerlessProcesses[serverlessId] && registeredServerlessProcesses[serverlessId].process === process) {
                   delete registeredServerlessProcesses[serverlessId];
              }
          });
    }

    return server;
}

module.exports = createServerlessAPIProxy;