const InternalWebhookStatusTracker = require('./InternalWebhookProgressTracker').getInstance();
const logger = $$.getLogger("WebhookComponent", "apihub");

function InternalWebhook(server) {
    try {
        logger.info("Initializing Webhook component...");
        
        function requestServerMiddleware(req, res, next) {
            req.server = server;
            next();
        }

        const {responseModifierMiddleware, requestBodyJSONMiddleware} = require("../../http-wrapper/utils/middlewares");

        server.use('/internalWebhook/*', requestServerMiddleware);
        server.use('/internalWebhook/*', responseModifierMiddleware);

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
                res.end(JSON.stringify({status: 'completed', result, progress }));
            } else {
                res.statusCode = 200;
                res.end(JSON.stringify({status: 'pending', progress}));
            }
        });

        server.put('/internalWebhook/result', requestBodyJSONMiddleware);
        server.put('/internalWebhook/result', (req, res) => {
            const data = req.body;
            if (!data.callId) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Missing callId parameter' }));
            }

            InternalWebhookStatusTracker.storeResult(data.callId, data.result || true);
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