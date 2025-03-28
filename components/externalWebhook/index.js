function ExternalWebhook(server) {
    try {
        console.log("Initializing External Webhook component...");
        
        function requestServerMiddleware(req, res, next) {
            req.server = server;
            next();
        }

        const {responseModifierMiddleware, requestBodyJSONMiddleware} = require("../../http-wrapper/utils/middlewares");

        server.use('/externalWebhook/*', requestServerMiddleware);

        server.put('/externalWebhook/result', requestBodyJSONMiddleware);
        server.put('/externalWebhook/result', (req, res) => {
            const data = req.body;
            res.statusCode = 200;
            res.end(JSON.stringify(data));
        });

        server.post('/externalWebhook/result', requestBodyJSONMiddleware);
        server.post('/externalWebhook/result', (req, res) => {
            const data = req.body;
            res.statusCode = 200;
            res.end(JSON.stringify(data));
        });

        console.log("External Webhook component initialized successfully");
    } catch (error) {
        console.error("Failed to initialize External Webhook component:", error);
        throw error;
    }
}

module.exports = ExternalWebhook; 