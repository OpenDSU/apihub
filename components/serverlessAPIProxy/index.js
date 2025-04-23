const httpWrapper = require("../../http-wrapper/src/httpUtils");
const { fork } = require('child_process');

const createServerlessAPIProxy = async (server) => {
    const urlPrefix = '/proxy'
    const registeredServerlessProcesses = {};

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

        let envVars = {};
        if (req.body) {
             try {
                 const parsedBody = JSON.parse(req.body);
                 if (typeof parsedBody === 'object' && parsedBody !== null) {
                     envVars = parsedBody;
                 } else {
                     console.warn("Request body is not a valid JSON object for env vars, using secrets or empty.");
                 }
             } catch (e) {
                 console.warn("Failed to parse request body for env vars, using secrets or empty:", e);
             }
        } 
        
        if (Object.keys(envVars).length === 0) {
            try {
                const apiHub = require('apihub');
                const secretsService = await apiHub.getSecretsServiceInstanceAsync(server.rootFolder);
                const secretsEnv = await secretsService.getSecretsAsync('env');
                 if (typeof secretsEnv === 'object' && secretsEnv !== null) {
                     envVars = secretsEnv;
                 } else {
                     console.log('Environment variables from secrets service were not an object, using empty env.');
                 }
            } catch (err) {
                console.log('No environment variables found in secrets service or request body, continuing with empty env:', err.message);
            }
        }
        
        const { process: oldProcess, config, scriptPath } = processInfo;

        console.log(`Restarting serverless process ${serverlessId} with new environment variables.`);

        if (oldProcess && !oldProcess.killed) {
             oldProcess.kill('SIGTERM');
             // Wait for the old process to potentially release resources before forking anew
             await new Promise(resolve => setTimeout(resolve, 200));
        }
        delete registeredServerlessProcesses[serverlessId]; 

        const forkOptions = {
            env: { ...process.env, ...envVars },
            // Explicitly configure stdio streams and IPC channel
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'] 
        };

        try {
            const newProcess = fork(scriptPath, [], forkOptions);
            
            // Add defensive check for stdout/stderr
            if (!newProcess || !newProcess.stdout || !newProcess.stderr) {
                console.error(`[${serverlessId}] Forked process object is missing stdout/stderr streams! Killing potentially orphaned process.`);
                if(newProcess && typeof newProcess.kill === 'function') {
                    newProcess.kill();
                }
                throw new Error("Forked child process object is invalid (missing stdio streams).");
            }

            // Capture stdout and stderr from the child process
            newProcess.stdout.on('data', (data) => {
                console.log(`[${serverlessId} PID:${newProcess.pid} STDOUT]: ${data.toString().trim()}`);
            });

            newProcess.stderr.on('data', (data) => {
                console.error(`[${serverlessId} PID:${newProcess.pid} STDERR]: ${data.toString().trim()}`);
            });

            registeredServerlessProcesses[serverlessId] = { 
                process: newProcess, 
                config: config, 
                scriptPath: scriptPath,
                url: null
            };

            // Send the start message to the new process with its config
            newProcess.send({ type: 'start', config: config });

            console.log(`Forked new process for ${serverlessId} with PID: ${newProcess.pid}`);

            newProcess.on('message', (message) => {
                if (message.type === 'ready' && message.url) {
                     console.log(`New serverless process ${serverlessId} (PID: ${newProcess.pid}) reported ready at ${message.url}`);
                     if (registeredServerlessProcesses[serverlessId]) {
                          registeredServerlessProcesses[serverlessId].url = message.url;
                     } else {
                          console.warn(`Process ${serverlessId} (PID: ${newProcess.pid}) reported ready, but was no longer registered.`);
                     }
                     if (!res.headersSent) {
                         res.statusCode = 200;
                         res.write(JSON.stringify({ statusCode: 200, message: `Serverless process ${serverlessId} restarted successfully with new environment.`, newUrl: message.url }));
                         res.end();
                     }
                } else if (message.type === 'error') {
                     console.error(`New serverless process ${serverlessId} (PID: ${newProcess.pid}) reported an error:`, message.error);
                     delete registeredServerlessProcesses[serverlessId];
                     if (!res.headersSent) {
                         res.statusCode = 500;
                         res.write(JSON.stringify({ message: `Failed to start new serverless process ${serverlessId} after restart.`, error: message.error }));
                         res.end();
                     }
                     newProcess.kill();
                }
            });

            newProcess.on('error', (err) => {
                console.error(`Error spawning or communicating with new serverless process ${serverlessId} (PID: ${newProcess.pid || 'N/A'}):`, err);
                 delete registeredServerlessProcesses[serverlessId];
                if (!res.headersSent) {
                    res.statusCode = 500;
                    res.write(JSON.stringify({ message: `Failed to restart serverless process ${serverlessId}.`, error: err.message }));
                    res.end();
                }
            });

            newProcess.on('exit', (code, signal) => {
                console.log(`Serverless process ${serverlessId} (PID: ${newProcess.pid || 'N/A'}) exited with code ${code}, signal ${signal}.`);
                 if (registeredServerlessProcesses[serverlessId] && registeredServerlessProcesses[serverlessId].process === newProcess) {
                     console.log(`Cleaning up registration for exited process ${serverlessId}`);
                     delete registeredServerlessProcesses[serverlessId];
                 }
            });

            const readyTimeout = setTimeout(() => {
                if (newProcess && !newProcess.killed && (!registeredServerlessProcesses[serverlessId])) {
                     console.error(`Timeout waiting for new serverless process ${serverlessId} (PID: ${newProcess.pid}) to become ready. Killing process.`);
                     newProcess.kill();
                     delete registeredServerlessProcesses[serverlessId];
                     if (!res.headersSent) {
                         res.statusCode = 500;
                         res.write(JSON.stringify({ message: `Timeout waiting for restarted serverless process ${serverlessId} to become ready.` }));
                         res.end();
                     }
                 }
             }, 30000);

            newProcess.on('message', (message) => {
                if (message.type === 'ready' || message.type === 'error') {
                    clearTimeout(readyTimeout);
                }
             });
            newProcess.on('exit', () => clearTimeout(readyTimeout));


        } catch (err) {
            console.error(`Error trying to fork or setup new process for ${serverlessId}:`, err.message); 
            delete registeredServerlessProcesses[serverlessId];
            if (!res.headersSent) {
                 res.statusCode = 500;
                 res.write(JSON.stringify({ message: `Failed to initiate restart for serverless process ${serverlessId}.`, error: err.message }));
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