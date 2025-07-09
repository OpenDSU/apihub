const InternalWebhookStatusTracker = require('./InternalWebhookProgressTracker').getInstance();
const logger = $$.getLogger("WebhookComponent", "apihub");

function InternalWebhook(server) {
    try {
        logger.info("Initializing Webhook component...");

        const LONG_POLLING_TIMEOUT = parseInt(process.env.WEBHOOK_LONG_POLLING_TIMEOUT) || 30000;
        logger.info(`Long polling timeout set to ${LONG_POLLING_TIMEOUT}ms`);

        const waitingConnections = new Map();

        function requestServerMiddleware(req, res, next) {
            req.server = server;
            next();
        }

        const { responseModifierMiddleware, requestBodyJSONMiddleware } = require("../../http-wrapper/utils/middlewares");

        server.use('/internalWebhook/*', requestServerMiddleware);
        server.use('/internalWebhook/*', responseModifierMiddleware);

        const respondToWaitingConnections = (callId, statusOverride = null) => {
            if (waitingConnections.has(callId)) {
                const connections = waitingConnections.get(callId);
                const result = InternalWebhookStatusTracker.getResult(callId);
                const progress = InternalWebhookStatusTracker.getProgress(callId);

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

        const handleCallIdExpiry = (callId) => {
            console.log(`CallId ${callId} expired after 3 minutes of inactivity`);

            respondToWaitingConnections(callId, 'expired');

            if (waitingConnections.has(callId)) {
                const connections = waitingConnections.get(callId);
                connections.forEach(({ res, timeout }) => {
                    clearTimeout(timeout);
                    if (!res.headersSent) {
                        res.writeHead(408, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Request expired after 3 minutes of inactivity' }));
                    }
                });
                waitingConnections.delete(callId);
            }

            InternalWebhookStatusTracker.cleanupCallId(callId);
        };

        server.get('/internalWebhook/:callId', (req, res) => {
            const callId = req.params.callId;
            if (!callId) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Missing callId parameter' }));
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

        console.log("Internal Webhook component initialized successfully");
    } catch (error) {
        console.error("Failed to initialize Webhook component:", error);
        throw error;
    }
}

module.exports = InternalWebhook; 