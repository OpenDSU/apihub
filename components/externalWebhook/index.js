function ExternalWebhook(server) {
    try {
        console.log("Initializing External Webhook component...");
        
        let responses = {}
        function requestServerMiddleware(req, res, next) {
            req.server = server;
            next();
        }

        const {responseModifierMiddleware, requestBodyJSONMiddleware} = require("../../http-wrapper/utils/middlewares");

        // server.use('/externalWebhook/*', requestServerMiddleware);

        server.put('/externalWebhook/result', requestBodyJSONMiddleware);
        server.put('/externalWebhook/result', (req, res) => {
            const body = req.body;
            const id = body.id;
            responses[id] = body.data;
            res.statusCode = 200;
            res.end();
        });

        server.post('/externalWebhook/result', requestBodyJSONMiddleware);
        server.post('/externalWebhook/result', (req, res) => {
            const body = req.body;
            const id = body.id;
            responses[id] = body.data;
            res.statusCode = 200;
            res.end();
        });

        server.get('/externalWebhook/:id', (req, res) => {
            const id = req.params.id;
            if (responses[id]) {
                res.statusCode = 200;
                const response = responses[id];
                delete responses[id];
                res.end(JSON.stringify({status: "completed", result: response}));
            } else {
                res.statusCode = 404;
                res.end();
            }
        });

        console.log("External Webhook component initialized successfully");
    } catch (error) {
        console.error("Failed to initialize External Webhook component:", error);
        throw error;
    }
}

module.exports = ExternalWebhook; 