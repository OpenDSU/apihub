require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const dc = require("double-check");
const {assert} = dc;
const path = require("path");

const longRunningPluginPath = path.join(__dirname, "LongRunningPlugin.js");

assert.callback("Test serverless API with long-running methods", async (testFinished) => {
    dc.createTestFolder('serverlessAPILongRunning', async (err, folder) => {
        const result = await tir.launchApiHubTestNodeAsync({rootFolder: folder});
        const server = result.node;
        const urlPrefix = "/test";
        const namespace = "LongRunningPlugin";

        try {
            const serverlessAPI = await server.createServerlessAPI({urlPrefix});
            const serverUrl = serverlessAPI.getUrl();

            let client = require("opendsu").loadAPI("serverless").createServerlessAPIClient("admin", serverUrl, namespace);
            await client.registerPlugin(namespace, longRunningPluginPath);
            console.log("Starting long-running operation test...");
            const startTime = Date.now();
            const result = await client.longOperation(5000);

            const endTime = Date.now();
            const executionTime = endTime - startTime;

            assert.true(executionTime >= 5000,
                `Long-running operation should take at least 5000ms, but took ${executionTime}ms`);

            // Verify the result
            assert.true(result === "Completed long operation",
                `Result should be "Completed long operation" but got "${result}"`);

            console.log(`Long-running operation completed in ${executionTime}ms`);
            testFinished();
        } catch (error) {
            console.error("Test failed with error:", error);
            server.close();
            testFinished(error);
        }
    });
}, 60000);