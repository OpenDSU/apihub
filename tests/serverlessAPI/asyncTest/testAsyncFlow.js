require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const path = require("path");
const dc = require("double-check");
const {assert} = dc;
const WebhookServer = require('./WebhookServer');
const fs = require('fs');

assert.callback("Test Serverless API Async Flow", async (testFinished) => {
    dc.createTestFolder('serverlessAPIAsync', async (err, folder) => {
        const result = await tir.launchApiHubTestNodeAsync({rootFolder: folder});
        const server = result.node;

        // Start the webhook server for async results
        const webhookServer = new WebhookServer(8090);
        await webhookServer.start();
        console.log(`Webhook server started at ${webhookServer.getUrl()}`);

        // Configure the serverless API
        const serverlessId = "test";

        // Create plugins directory
        const pluginsDir = path.join(folder, 'plugins');
        fs.mkdirSync(pluginsDir, {recursive: true});

        // Copy the AsyncPlugin to the plugins directory
        const asyncPluginSrc = path.join(__dirname, "AsyncPlugin.js");
        const asyncPluginDest = path.join(pluginsDir, "AsyncPlugin.js");
        fs.copyFileSync(asyncPluginSrc, asyncPluginDest);

        // Create the serverless API with the folder containing plugin structure
        const serverlessAPI = await server.createServerlessAPI({
            urlPrefix: serverlessId,
            storage: folder
        });

        const serverUrl = serverlessAPI.getUrl();
        console.log(`Serverless API started at ${serverUrl}`);
        server.registerServerlessProcessUrl(serverlessId, serverUrl);

        // Create the enhanced serverless client that supports async operations
        const {createEnhancedServerlessClient} = require('./EnhancedServerlessClient');

        // Set the webhook URL as an environment variable for the serverless API process
        process.env.WEBHOOK_URL = `${webhookServer.getUrl()}/result`;

        const client = createEnhancedServerlessClient("admin", `${result.url}/proxy`, serverlessId, "AsyncPlugin", process.env.WEBHOOK_URL);

        // Test synchronous operation first
        const syncResult = await client.syncOperation();
        assert.true(typeof syncResult === 'string', "Sync operation should return a string");
        console.log("Sync operation result:", syncResult);

        // Test asynchronous operation
        console.log("Starting async operation...");

        // Optional: Set up a progress listener if needed
        const progressUpdates = [];
        const unsubscribeProgress = client.onProgress((progressEvent) => {
            console.log(`Progress update for ${progressEvent.commandName}: ${JSON.stringify(progressEvent.data)}`);
            progressUpdates.push(progressEvent);
        });

        // Call the method - the API is the same whether it's sync or async
        const asyncResult = await client.processDataAsync({
            items: 100,
            type: "test-data"
        });

        // Verify the result
        assert.true(asyncResult.processed === true, "Result should indicate processing completed");
        assert.true(asyncResult.items === 100, "Result should include processed items count");

        // Test another async operation
        console.log("Starting report generation...");
        const reportResult = await client.generateReportAsync({
            reportType: "test",
            format: "json",
            parameters: {
                startDate: "2025-01-01",
                endDate: "2025-03-01"
            }
        });

        // Verify report result
        assert.true(reportResult.success === true, "Report should have been generated successfully");

        server.close();
        testFinished();
        console.log("======>>>>>>>>>>")
    })
}, 50000);