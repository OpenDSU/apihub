const WebhookProgressTracker = require('./WebhookProgressTracker').getInstance();
const logger = $$.getLogger("WebhookComponent", "apihub");

function Webhook(server) {
    try {
        logger.info("Initializing Webhook component...");
        
        function requestServerMiddleware(req, res, next) {
            req.server = server;
            next();
        }

        const {responseModifierMiddleware, requestBodyJSONMiddleware} = require("../../http-wrapper/utils/middlewares");

        server.use('/webhook/*', requestServerMiddleware);
        server.use('/webhook/*', responseModifierMiddleware);

        server.get('/webhook/:callId', (req, res) => {
            const callId = req.params.callId;
            if (!callId) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Missing callId parameter' }));
            }

            const result = WebhookProgressTracker.getResult(callId);
            const progress = WebhookProgressTracker.getProgress(callId);
            if (result) {
                res.statusCode = 200;
                res.end(JSON.stringify({status: 'completed', result, progress }));
            } else {
                res.statusCode = 200;
                res.end(JSON.stringify({status: 'pending', progress}));
            }
        });

        server.put('/webhook/result', requestBodyJSONMiddleware);
        server.put('/webhook/result', (req, res) => {
            const data = req.body;
            if (!data.callId) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Missing callId parameter' }));
            }

            WebhookProgressTracker.storeResult(data.callId, data.result || true);
            res.statusCode = 200;
            res.end(JSON.stringify({ success: true, message: 'Result stored successfully' }));
        });

        server.put('/webhook/progress', requestBodyJSONMiddleware);
        server.put('/webhook/progress', (req, res) => {
            const data = req.body;
            if (!data.callId) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Missing callId parameter' }));
            }

            WebhookProgressTracker.storeProgress(data.callId, data.progress);
            res.statusCode = 200;
            res.end(JSON.stringify({ success: true, message: 'Progress stored successfully' }));
        });

        server.put('/webhook/expiryTime', requestBodyJSONMiddleware);
        server.put('/webhook/expiryTime', (req, res) => {
            const data = req.body;
            WebhookProgressTracker.setExpiryTime(data.callId, data.expiryTime);
            res.statusCode = 200;
            res.end(JSON.stringify({ success: true, message: 'Expiry time set successfully' }));
        });

        logger.info("Webhook component initialized successfully");
    } catch (error) {
        logger.error("Failed to initialize Webhook component:", error);
        throw error;
    }
}

module.exports = Webhook; 