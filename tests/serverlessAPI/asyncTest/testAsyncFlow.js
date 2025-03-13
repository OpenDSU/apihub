require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const path = require("path");
const dc = require("double-check");
const {assert} = dc;
const WebhookServer = require('./WebhookServer');

assert.callback("Test Serverless API Async Flow", async (testFinished) => {
    dc.createTestFolder('serverlessAPIAsync', async (err, folder) => {
        try {
            // 1. Start the ApiHub node
            const result = await tir.launchApiHubTestNodeAsync({rootFolder: folder});
            const server = result.node;

            // 2. Start the webhook server for async results
            const webhookServer = new WebhookServer(8090);
            await webhookServer.start();
            console.log(`Webhook server started at ${webhookServer.getUrl()}`);

            // 3. Configure the serverless API
            const urlPrefix = "/test";
            const coreConfig = {};
            const asyncPluginPath = path.join(__dirname, "AsyncPlugin.js");
            const pluginName = "AsyncPlugin";
            const coreConfigs = {};

            coreConfigs[pluginName] = {
                corePath: asyncPluginPath,
                coreConfig
            };

            // 4. Create the serverless API
            const serverlessAPI = await server.createServerlessAPI({
                urlPrefix
            });

            const serverUrl = serverlessAPI.getUrl();
            console.log(`Serverless API started at ${serverUrl}`);

            // 5. Create the enhanced serverless client that supports async operations
            const { createEnhancedServerlessClient } = require('./EnhancedServerlessClient');

            // Set the webhook URL as an environment variable for the serverless API process
            process.env.WEBHOOK_URL = `${webhookServer.getUrl()}/result`;

            const client = createEnhancedServerlessClient("admin", serverUrl, pluginName, process.env.WEBHOOK_URL);

            // 6. Register the plugin
            await client.registerPlugin(pluginName, asyncPluginPath);
            console.log("Plugin registered successfully");

            // 7. Test synchronous operation first
            const syncResult = await client.syncOperation();
            assert.true(typeof syncResult === 'string', "Sync operation should return a string");
            console.log("Sync operation result:", syncResult);

            // 8. Test asynchronous operation
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

            // We can unsubscribe from progress events if we no longer need them
            unsubscribeProgress();

            // Assert that we received progress updates through the event emitter
            assert.true(progressUpdates.length > 0, "Should have received progress updates");

            // Verify the result
            assert.true(asyncResult.processed === true, "Result should indicate processing completed");
            assert.true(asyncResult.items === 100, "Result should include processed items count");

            // 9. Test another async operation
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
            assert.true(reportResult.reportId !== undefined, "Result should include a report ID");
            assert.true(reportResult.generatedAt !== undefined, "Result should include generation timestamp");

            // 10. Test the generic operation that happens to be async
            console.log("Starting generic operation...");
            const genericResult = await client.genericOperation("customOperation", {
                action: "test",
                data: {
                    value: 42
                }
            });

            // Verify generic result
            assert.true(genericResult.completed === true, "Generic result should indicate completion");
            assert.true(genericResult.operationType === "customOperation", "Generic result should include operation type");

            // Clean up
            console.log("Tests completed, cleaning up...");
            client.cleanup();
            await webhookServer.stop();
            server.close();

            testFinished();
        } catch (error) {
            console.error("Test failed:", error);
            // Ensure cleanup even if test fails
            if (webhookServer) {
                await webhookServer.stop().catch(() => {});
            }
            if (server) {
                server.close();
            }
            testFinished(error);
        }
    });
}, 60000); // Increase timeout to 60 seconds to account for async operations