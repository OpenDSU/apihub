require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const path = require("path");
const dc = require("double-check");
const {assert} = dc;
const fs = require('fs');

assert.callback("Test Serverless API Async Flow", async (testFinished) => {
    dc.createTestFolder('serverlessAPIAsync', async (err, folder) => {
        const result = await tir.launchApiHubTestNodeAsync({rootFolder: folder});
        const server = result.node;

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
        const {createServerlessAPIClient} = require("opendsu").loadAPI("serverless");

        // Set the webhook URL as an environment variable for the serverless API process
        process.env.WEBHOOK_URL = `${result.url}/webhook/result`;

        const client = createServerlessAPIClient("admin", result.url, serverlessId, "AsyncPlugin", process.env.WEBHOOK_URL);

        // Test synchronous operation first
        console.log("Testing synchronous operation...");
        const syncResult = await client.syncOperation();
        assert.true(typeof syncResult === 'string', "Sync operation should return a string");
        assert.true(syncResult === "This is a synchronous operation response", 
            `Expected "This is a synchronous operation response", got "${syncResult}"`);
        console.log("Sync operation result:", syncResult);

        // Call the async method
        const asyncResult = await client.processDataAsync({
            items: 100,
            type: "test-data"
        });

        // Verify the async result
        assert.true(asyncResult.processed === true, "Result should indicate processing completed");
        assert.true(asyncResult.items === 100, "Result should include processed items count");

        // Test another async operation without progress tracking
        console.log("Starting report generation without progress tracking...");
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
        assert.true(typeof reportResult.reportId === 'string', "Report should have a reportId");
        assert.true(typeof reportResult.generatedAt === 'string', "Report should have a generation timestamp");

        // Test generic async operation
        console.log("Testing generic async operation...");
        const genericResult = await client.genericOperation("testOperation", {
            param1: "value1",
            param2: "value2"
        });

        // Verify generic operation result
        assert.true(genericResult.completed === true, "Generic operation should indicate completion");
        assert.true(genericResult.operationType === "testOperation", "Result should include the operation type");

        server.close();
        testFinished();
        console.log("======>>>>>>>>>>")
    })
}, 50000);