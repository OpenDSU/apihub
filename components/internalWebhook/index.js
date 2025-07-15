const InternalWebhookStatusTracker = require('./InternalWebhookProgressTracker').getInstance();
const logger = $$.getLogger("WebhookComponent", "apihub");

function InternalWebhook(server) {
    try {
        logger.info("Initializing Webhook component...");

        const LONG_POLLING_TIMEOUT = parseInt(process.env.WEBHOOK_LONG_POLLING_TIMEOUT) || 30000;
        logger.info(`Long polling timeout set to ${LONG_POLLING_TIMEOUT}ms`);

        const waitingConnections = new Map();
        // Map to track callId -> serverlessId relationships for process health checking
        const callIdToServerlessId = new Map();

        // Set up the mapping function for the progress tracker
        InternalWebhookStatusTracker.setServerlessIdMapping((callId) => {
            return callIdToServerlessId.get(callId);
        });

        // Track process unavailability and clean up associated callIds
        const processUnavailabilityHistory = new Map(); // serverlessId -> timestamp of last unavailability

        // Store active process listeners for cleanup
        const processListeners = new Map();

        // Function to clean up process-specific callIds
        const cleanupProcessCallIds = (serverlessId, reason) => {
            console.log(`[WEBHOOK] Process ${serverlessId} ${reason} - cleaning up associated callIds`);

            // Clean up all callIds associated with this serverless process
            InternalWebhookStatusTracker.cleanupCallIdsForUnavailableProcess(serverlessId);

            // Mark this unavailability as handled
            processUnavailabilityHistory.set(serverlessId, Date.now());

            // Clean up callId mappings for this serverless process
            const callIdsToRemove = [];
            for (const [callId, mappedServerlessId] of callIdToServerlessId.entries()) {
                if (mappedServerlessId === serverlessId) {
                    callIdsToRemove.push(callId);
                }
            }

            callIdsToRemove.forEach(callId => {
                callIdToServerlessId.delete(callId);
            });

            if (callIdsToRemove.length > 0) {
                console.log(`[WEBHOOK] Cleaned up ${callIdsToRemove.length} callId mappings for ${reason} serverless: ${serverlessId}`);
            }
        };

        // Function to set up listeners for a specific process
        const setupProcessListeners = (serverlessId, processInfo) => {
            if (!processInfo || !processInfo.process) {
                return;
            }

            const process = processInfo.process;

            // Remove existing listeners if any
            if (processListeners.has(serverlessId)) {
                const existingListeners = processListeners.get(serverlessId);
                existingListeners.forEach(({ event, listener }) => {
                    process.removeListener(event, listener);
                });
            }

            // Create new listeners
            const listeners = [];

            // Listen for process exit
            const exitListener = (code, signal) => {
                console.log(`[WEBHOOK] Process ${serverlessId} exited with code ${code}, signal ${signal}`);
                cleanupProcessCallIds(serverlessId, 'exited');
            };
            process.on('exit', exitListener);
            listeners.push({ event: 'exit', listener: exitListener });

            // Listen for process errors
            const errorListener = (error) => {
                console.log(`[WEBHOOK] Process ${serverlessId} error:`, error.message);
                cleanupProcessCallIds(serverlessId, 'encountered error');
            };
            process.on('error', errorListener);
            listeners.push({ event: 'error', listener: errorListener });

            // Listen for process disconnect (if it's a forked process)
            if (typeof process.disconnect === 'function') {
                const disconnectListener = () => {
                    console.log(`[WEBHOOK] Process ${serverlessId} disconnected`);
                    cleanupProcessCallIds(serverlessId, 'disconnected');
                };
                process.on('disconnect', disconnectListener);
                listeners.push({ event: 'disconnect', listener: disconnectListener });
            }

            // Store listeners for cleanup
            processListeners.set(serverlessId, listeners);
        };

        // Function to remove listeners for a process
        const removeProcessListeners = (serverlessId) => {
            if (processListeners.has(serverlessId)) {
                const listeners = processListeners.get(serverlessId);
                // Note: We can't remove listeners here since the process might be dead
                // But we can clear our tracking
                processListeners.delete(serverlessId);
            }
        };

        // Set up listeners for all existing processes
        if (server.processManager) {
            const allProcesses = server.processManager.getAllProcesses();
            for (const [serverlessId, processInfo] of allProcesses.entries()) {
                setupProcessListeners(serverlessId, processInfo);
            }

            // Listen for new processes being registered
            if (typeof server.processManager.on === 'function') {
                server.processManager.on('processRegistered', (serverlessId, processInfo) => {
                    console.log(`[WEBHOOK] Setting up listeners for new process: ${serverlessId}`);
                    setupProcessListeners(serverlessId, processInfo);
                    // Clear any previous unavailability history
                    processUnavailabilityHistory.delete(serverlessId);
                });

                server.processManager.on('processRestarting', (serverlessId) => {
                    console.log(`[WEBHOOK] Process ${serverlessId} is restarting`);
                    cleanupProcessCallIds(serverlessId, 'restarting');
                    removeProcessListeners(serverlessId);
                });

                server.processManager.on('processUnregistered', (serverlessId) => {
                    console.log(`[WEBHOOK] Process ${serverlessId} unregistered`);
                    cleanupProcessCallIds(serverlessId, 'unregistered');
                    removeProcessListeners(serverlessId);
                });
            }
        }

        // Expose process availability detection function for manual triggering (fallback)
        server.triggerProcessAvailabilityCheck = () => {
            console.log('[WEBHOOK] Manual process availability check triggered');
            if (server.processManager) {
                const allProcesses = server.processManager.getAllProcesses();
                for (const [serverlessId, processInfo] of allProcesses.entries()) {
                    // Check if process is healthy and set up listeners if needed
                    if (processInfo && processInfo.process && !processInfo.process.killed && processInfo.process.exitCode === null) {
                        if (!processListeners.has(serverlessId)) {
                            setupProcessListeners(serverlessId, processInfo);
                        }
                    } else {
                        // Process is not healthy, clean up
                        cleanupProcessCallIds(serverlessId, 'unhealthy');
                    }
                }
            }
        };

        // Expose direct cleanup function for specific serverless processes
        server.cleanupCallIdsForServerlessId = (serverlessId) => {
            cleanupProcessCallIds(serverlessId, 'manually triggered');
        };

        // Clean up listeners when webhook component is destroyed
        const originalDestroy = server.destroy;
        server.destroy = function () {
            // Clean up all process listeners
            for (const [serverlessId, listeners] of processListeners.entries()) {
                if (server.processManager) {
                    const processInfo = server.processManager.getProcessInfo(serverlessId);
                    if (processInfo && processInfo.process) {
                        listeners.forEach(({ event, listener }) => {
                            try {
                                processInfo.process.removeListener(event, listener);
                            } catch (error) {
                                // Process might be dead, ignore errors
                            }
                        });
                    }
                }
            }
            processListeners.clear();

            if (originalDestroy) {
                originalDestroy.apply(this, arguments);
            }
        };

        function requestServerMiddleware(req, res, next) {
            req.server = server;
            next();
        }

        const { responseModifierMiddleware, requestBodyJSONMiddleware } = require("../../http-wrapper/utils/middlewares");

        server.use('/internalWebhook/*', requestServerMiddleware);
        server.use('/internalWebhook/*', responseModifierMiddleware);

        // Helper function to check if a serverless process is healthy
        const isProcessHealthy = (serverlessId) => {
            if (!server.processManager || !serverlessId) {
                return true; // Assume healthy if we can't check or no serverlessId
            }

            const processInfo = server.processManager.getProcessInfo(serverlessId);
            if (!processInfo) {
                return false; // Process not found
            }

            // From webhook perspective, both restart and down mean callId won't complete
            // Check if process is restarting OR not alive
            if (server.processManager.isRestarting(serverlessId)) {
                return false; // Process is restarting - callId won't complete
            }

            // Check if process is still alive
            const process = processInfo.process;
            if (!process || process.killed || process.exitCode !== null) {
                return false; // Process is dead - callId won't complete
            }

            return true; // Process appears healthy
        };

        // Helper function to create and send error response for unhealthy process
        const sendProcessUnhealthyError = (res, callId, serverlessId) => {
            const errorResponse = {
                status: 'error',
                code: 'PROCESS_UNAVAILABLE',
                message: `Serverless process ${serverlessId} is unavailable (down or restarting)`,
                callId: callId,
                serverlessId: serverlessId
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(errorResponse));

            // Clean up webhook data for this callId
            InternalWebhookStatusTracker.cleanupCallId(callId);
            callIdToServerlessId.delete(callId);
        };

        const respondToWaitingConnections = (callId, statusOverride = null) => {
            if (waitingConnections.has(callId)) {
                const connections = waitingConnections.get(callId);
                const result = InternalWebhookStatusTracker.getResult(callId);
                const progress = InternalWebhookStatusTracker.getProgress(callId);

                // Check process health before responding
                const serverlessId = callIdToServerlessId.get(callId);
                if (serverlessId && !isProcessHealthy(serverlessId)) {
                    // Process is down, send error to all waiting connections
                    connections.forEach(({ res, timeout }) => {
                        clearTimeout(timeout);
                        sendProcessUnhealthyError(res, callId, serverlessId);
                    });
                    waitingConnections.delete(callId);
                    return;
                }

                connections.forEach(({ res, timeout }) => {
                    clearTimeout(timeout);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    if (statusOverride) {
                        res.end(JSON.stringify({ status: statusOverride, result: undefined, progress }));
                    } else if (result) {
                        res.end(JSON.stringify({ status: 'completed', result, progress }));
                    } else {
                        res.end(JSON.stringify({ status: 'pending', progress }));
                    }
                });

                if (progress && connections.length > 0) {
                    InternalWebhookStatusTracker.consumeProgress(callId);
                }

                waitingConnections.delete(callId);
            }
        };

        const WEBHOOK_EXPIRY_TIME = parseInt(process.env.WEBHOOK_EXPIRY_TIME) || 5 * 60 * 1000; // 5 minutes default
        const WEBHOOK_EXPIRY_MINUTES = WEBHOOK_EXPIRY_TIME / 1000 / 60;

        const handleCallIdExpiry = (callId) => {
            console.log(`CallId ${callId} expired after ${WEBHOOK_EXPIRY_MINUTES} minutes of inactivity`);

            respondToWaitingConnections(callId, 'expired');

            if (waitingConnections.has(callId)) {
                const connections = waitingConnections.get(callId);
                connections.forEach(({ res, timeout }) => {
                    clearTimeout(timeout);
                    if (!res.headersSent) {
                        res.writeHead(408, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: `Request expired after ${WEBHOOK_EXPIRY_MINUTES} minutes of inactivity` }));
                    }
                });
                waitingConnections.delete(callId);
            }

            InternalWebhookStatusTracker.cleanupCallId(callId);
            // Clean up callId mapping
            callIdToServerlessId.delete(callId);
        };

        server.get('/internalWebhook/:callId', (req, res) => {
            const callId = req.params.callId;
            if (!callId) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Missing callId parameter' }));
            }

            // Check if we have a serverlessId mapping and if the process is healthy
            const serverlessId = callIdToServerlessId.get(callId);

            if (serverlessId && !isProcessHealthy(serverlessId)) {
                // Immediately trigger cleanup for this serverless process
                InternalWebhookStatusTracker.cleanupCallIdsForUnavailableProcess(serverlessId);
                return sendProcessUnhealthyError(res, callId, serverlessId);
            }

            const result = InternalWebhookStatusTracker.getResult(callId);
            const progress = InternalWebhookStatusTracker.getProgress(callId);

            if (result) {
                res.statusCode = 200;
                return res.end(JSON.stringify({ status: 'completed', result, progress }));
            }

            if (progress) {
                res.statusCode = 200;
                InternalWebhookStatusTracker.consumeProgress(callId);
                return res.end(JSON.stringify({ status: 'pending', progress }));
            }

            InternalWebhookStatusTracker.onExpiry(callId, handleCallIdExpiry);

            if (!waitingConnections.has(callId)) {
                waitingConnections.set(callId, []);
            }

            const connections = waitingConnections.get(callId);

            const timeout = setTimeout(() => {
                const index = connections.findIndex(conn => conn.res === res);
                if (index !== -1) {
                    connections.splice(index, 1);
                }

                if (connections.length === 0) {
                    waitingConnections.delete(callId);
                }

                // Check process health before sending timeout response
                const serverlessId = callIdToServerlessId.get(callId);
                if (serverlessId && !isProcessHealthy(serverlessId)) {
                    // Immediately trigger cleanup for this serverless process
                    InternalWebhookStatusTracker.cleanupCallIdsForUnavailableProcess(serverlessId);
                    return sendProcessUnhealthyError(res, callId, serverlessId);
                }

                const currentProgress = InternalWebhookStatusTracker.getProgress(callId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'pending', progress: currentProgress }));

                if (currentProgress) {
                    InternalWebhookStatusTracker.consumeProgress(callId);
                }
            }, LONG_POLLING_TIMEOUT);

            res.on('close', () => {
                clearTimeout(timeout);
                const index = connections.findIndex(conn => conn.res === res);
                if (index !== -1) {
                    connections.splice(index, 1);
                }
                if (connections.length === 0) {
                    waitingConnections.delete(callId);
                    // Ensure expiry callback is still registered when connection closes
                    // This handles the case where client disconnects but data should still expire
                    InternalWebhookStatusTracker.onExpiry(callId, handleCallIdExpiry);
                }
            });

            connections.push({ res, timeout });
        });

        server.put('/internalWebhook/result', requestBodyJSONMiddleware);
        server.put('/internalWebhook/result', (req, res) => {
            const data = req.body;
            if (!data.callId) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Missing callId parameter' }));
            }

            // Store serverlessId mapping if provided in headers
            const serverlessId = req.headers['x-serverless-id'];

            if (serverlessId) {
                callIdToServerlessId.set(data.callId, serverlessId);
            }

            InternalWebhookStatusTracker.storeResult(data.callId, data.result || true);
            InternalWebhookStatusTracker.onExpiry(data.callId, handleCallIdExpiry);
            respondToWaitingConnections(data.callId);

            res.statusCode = 200;
            res.end(JSON.stringify({ success: true, message: 'Result stored successfully' }));
        });

        server.put('/internalWebhook/progress', requestBodyJSONMiddleware);
        server.put('/internalWebhook/progress', (req, res) => {
            const data = req.body;
            if (!data.callId) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Missing callId parameter' }));
            }

            // Store serverlessId mapping if provided in headers
            const serverlessId = req.headers['x-serverless-id'];

            if (serverlessId) {
                callIdToServerlessId.set(data.callId, serverlessId);
            }

            InternalWebhookStatusTracker.storeProgress(data.callId, data.progress);
            InternalWebhookStatusTracker.onExpiry(data.callId, handleCallIdExpiry);
            respondToWaitingConnections(data.callId);

            res.statusCode = 200;
            res.end(JSON.stringify({ success: true, message: 'Progress stored successfully' }));
        });

        server.put('/internalWebhook/expiryTime', requestBodyJSONMiddleware);
        server.put('/internalWebhook/expiryTime', (req, res) => {
            const data = req.body;
            InternalWebhookStatusTracker.setExpiryTime(data.callId, data.expiryTime);
            res.statusCode = 200;
            res.end(JSON.stringify({ success: true, message: 'Expiry time set successfully' }));
        });

        server.put('/internalWebhook/registerMapping', requestBodyJSONMiddleware);
        server.put('/internalWebhook/registerMapping', (req, res) => {
            const data = req.body;
            const serverlessId = req.headers['x-serverless-id'] || data.serverlessId;

            if (!data.callId || !serverlessId) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Missing callId or serverlessId parameter' }));
            }

            // Establish the mapping immediately
            callIdToServerlessId.set(data.callId, serverlessId);

            // Also register expiry callback to ensure cleanup happens
            InternalWebhookStatusTracker.onExpiry(data.callId, handleCallIdExpiry);

            res.statusCode = 200;
            res.end(JSON.stringify({ success: true, message: 'Mapping registered successfully' }));
        });

        console.log("Internal Webhook component initialized successfully");
    } catch (error) {
        console.error("Failed to initialize Webhook component:", error);
        throw error;
    }
}

module.exports = InternalWebhook; 