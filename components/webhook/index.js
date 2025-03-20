const InternalWebhook = require('./InternalWebhook').getInstance();
const logger = $$.getLogger("WebhookComponent", "apihub");

function Webhook(server) {
    try {
        logger.info("Initializing Webhook component...");
        
        function requestServerMiddleware(request, response, next) {
            request.server = server;
            next();
        }

        const {responseModifierMiddleware, requestBodyJSONMiddleware} = require("../../http-wrapper/utils/middlewares");

        // Register webhook endpoints
        server.use('/webhook/*', requestServerMiddleware);
        server.use('/webhook/*', responseModifierMiddleware);

        // Result endpoint
        server.get('/webhook/result', (req, res) => {
            const callId = req.query.callId;
            if (!callId) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Missing callId parameter' }));
            }

            const result = InternalWebhook.getResult(callId);
            if (result) {
                res.statusCode = 200;
                res.end(JSON.stringify({ status: 'completed', result }));
            } else {
                res.statusCode = 200;
                res.end(JSON.stringify({ status: 'pending', message: 'Result not available yet' }));
            }
        });

        // Status endpoint
        server.get('/webhook/status', (req, res) => {
            const status = {
                uptime: process.uptime(),
                resultsCount: InternalWebhook.getAllResults().length,
                timestamp: new Date().toISOString()
            };
            res.statusCode = 200;
            res.end(JSON.stringify(status));
        });

        // Store endpoint
        server.post('/webhook/store', requestBodyJSONMiddleware);
        server.post('/webhook/store', (req, res) => {
            const data = req.body;
            if (!data.callId) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Missing callId parameter' }));
            }

            if (!data.result) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Missing result parameter' }));
            }

            InternalWebhook.storeResult(data.callId, data.result);
            res.statusCode = 200;
            res.end(JSON.stringify({ success: true, message: 'Result stored successfully' }));
        });

        logger.info("Webhook component initialized successfully");
    } catch (error) {
        logger.error("Failed to initialize Webhook component:", error);
        throw error;
    }
}

module.exports = Webhook; 