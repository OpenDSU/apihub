const webhookComponent = async(server) => {
    const receivedWebhooks = [];
    server.post("/webhook", (req, res) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const webhookData = JSON.parse(body);
                console.log(`Webhook receiver got: ${JSON.stringify(webhookData)}`);
                receivedWebhooks.push(webhookData);
                res.statusCode = 200;
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                console.error("Failed to parse webhook data:", e);
                res.statusCode = 400;
                res.end(JSON.stringify({ success: false, error: "Invalid data format" }));
            }
        });
    })

    server.get("/webhook", (req, res) => {
        res.statusCode = 200;
        res.end(JSON.stringify(receivedWebhooks));
    })
}

module.exports = webhookComponent;
