require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const dc = require("double-check");
const {assert} = dc;
const path = require("path");
const fs = require("fs");
const http = require('http');

assert.callback("Test serverless API with external webhook", async (testFinished) => {
    dc.createTestFolder('serverlessAPI', async (err, folder) => {
        // Create plugins directory
        const pluginsDir = path.join(folder, 'plugins');
        fs.mkdirSync(pluginsDir, {recursive: true});

        // Create external webhook mock server
        let webhookData = null;
        const externalWebhook = http.createServer((req, res) => {
            if (req.method === 'GET' && req.url === '/webhook') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(webhookData || {status: 'pending'}));
            } else {
                res.statusCode = 404;
                res.end();
            }
        });

        // Start server on random available port
        await new Promise(resolve => externalWebhook.listen(0, 'localhost', resolve));
        const externalWebhookPort = externalWebhook.address().port;
        const externalWebhookUrl = `http://localhost:${externalWebhookPort}/webhook`;

        // Create files that require the plugins
        const webhookPluginSrc = path.join(__dirname, "ExternalWebhookPlugin.js");
        const webhookPluginContent = `module.exports = require("${webhookPluginSrc}");`;
        fs.writeFileSync(path.join(pluginsDir, "ExternalWebhookPlugin.js"), webhookPluginContent);

        // Launch API Hub test node
        const result = await tir.launchApiHubTestNodeAsync({
            rootFolder: folder
        });
        const server = result.node;
        const serverlessId = "test";

        // Create serverless API with the folder containing plugin structure
        const serverlessAPI = await server.createServerlessAPI({
            urlPrefix: serverlessId,
            storage: folder,
            env: {
                EXTERNAL_WEBHOOK_URL: `${result.url}/externalWebhook`,
                INTERNAL_WEBHOOK_URL: `${result.url}/internalWebhook`
            }
        });

        // Initialize plugins from the directory structure
        server.registerServerlessProcess(serverlessId, serverlessAPI);

        const {createServerlessAPIClient} = require("opendsu").loadAPI("serverless");

        // Test ExternalWebhookPlugin
        console.log("Creating client for ExternalWebhookPlugin...");
        const webhookClient = await createServerlessAPIClient("admin", result.url, serverlessId, "ExternalWebhookPlugin");

        // Test slow operation with external webhook
        const slowOperation = webhookClient.slowOperation();
        slowOperation.onProgress((progress) => {
            assert.true(progress.percent >= 0 && progress.percent <= 100,
                `Progress should be between 0 and 100, got ${progress.percent}`);
        });

        const slowResult = await slowOperation;
        assert.true(slowResult === 'test',
            `test", got "${slowResult}"`);

        testFinished();
    });
}, 150000);