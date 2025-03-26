require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const path = require("path");
const dc = require("double-check");
const { assert } = dc;
const fs = require('fs');

assert.callback("Test Serverless API Observable Flow", async (testFinished) => {
    dc.createTestFolder('serverlessAPIObservable', async (err, folder) => {
        const result = await tir.launchApiHubTestNodeAsync({ rootFolder: folder });
        const server = result.node;

        const serverlessId = "observableTest";
        const pluginsDir = path.join(folder, 'plugins');
        fs.mkdirSync(pluginsDir, { recursive: true });

        // Set up the plugin
        const observablePluginSrc = path.join(__dirname, "ObservableLambdaPlugin.js");
        const observablePluginContent = `module.exports = require("${observablePluginSrc}");`;
        fs.writeFileSync(path.join(pluginsDir, "ObservableLambdaPlugin.js"), observablePluginContent);

        // Create and configure the serverless API
        const serverlessAPI = await server.createServerlessAPI({
            urlPrefix: serverlessId,
            storage: folder,
            env: {
                WEBHOOK_URL: `${result.url}/webhook`
            }
        });

        const serverUrl = serverlessAPI.getUrl();
        console.log(`Serverless API started at ${serverUrl}`);
        server.registerServerlessProcessUrl(serverlessId, serverUrl);

        const { createServerlessAPIClient } = require("opendsu").loadAPI("serverless");

        // Create client and run tests
        const client = await createServerlessAPIClient(
            "admin",
            result.url,
            serverlessId,
            "ObservableLambdaPlugin",
            `${result.url}/webhook`
        );

        // Test quick synchronous operation
        const quickResponse = await client.quickObservableTest();
        assert.equal(quickResponse, "Quick observable test completed", "Quick test response doesn't match");
        console.log("Quick test completed successfully");

        // Test observable async operation
        const progressUpdates = [];
        const observableResponse = client.processDataObservableTest();

        observableResponse.onProgress((progress) => {
            console.log("Progress Update:", progress);
            progressUpdates.push(progress);

            // Verify progress object structure
            assert.true(typeof progress.percent === 'number', "Progress percent should be a number");
            assert.true(typeof progress.status === 'string', "Progress status should be a string");
            assert.true(typeof progress.details === 'string', "Progress details should be a string");
        });

        try {
            observableResponse.onEnd(() => {
                console.log("Observable operation completed");
                // Verify we got all progress updates
                assert.true(progressUpdates.length > 0, "Should have received progress updates");
                console.log(progressUpdates[progressUpdates.length - 1]);
                assert.true(progressUpdates[progressUpdates.length - 1].percent >= 80, "Should have reached near 100% progress");

                testFinished();
            });
        } catch (error) {
            assert.fail(error.message);
        }
    });
}, 50000); 