require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const path = require("path");
const dc = require("double-check");
const { assert } = dc;
const fs = require('fs');

assert.callback("Test Serverless API Async Flow", async (testFinished) => {
    dc.createTestFolder('serverlessAPIAsync', async (err, folder) => {
        const result = await tir.launchApiHubTestNodeAsync({ rootFolder: folder });
        const server = result.node;

        const serverlessId = "test";
        const pluginsDir = path.join(folder, 'plugins');
        fs.mkdirSync(pluginsDir, { recursive: true });

        const asyncPluginSrc = path.join(__dirname, "SlowLambdaPlugin.js");

        // Create a new file that requires the original plugin
        const asyncPluginContent = `module.exports = require("${asyncPluginSrc}");`;
        fs.writeFileSync(path.join(pluginsDir, "SlowLambdaPlugin.js"), asyncPluginContent);

        const serverlessAPI = await server.createServerlessAPI({
            urlPrefix: serverlessId,
            storage: folder,
            env: {
                INTERNAL_WEBHOOK_URL: `${result.url}/internalWebhook`
            }
        });

        server.registerServerlessProcess(serverlessId, serverlessAPI);

        const { createServerlessAPIClient } = require("opendsu").loadAPI("serverless");

        const client = await createServerlessAPIClient("admin", result.url, serverlessId, "SlowLambdaPlugin");
        const fastResponse = await client.fastOperationTest();
        console.log(fastResponse);

        const slowResponse = await client.processDataAsyncTest()
        slowResponse.onProgress((progress) => {
            console.log("On Progress", progress);
        });

        slowResponse.onEnd((result) => {
            console.log("On End", result);
            console.log("ERROR: Test should have failed due to process being killed, but it completed successfully");
            testFinished();
        });

        slowResponse.onError((error) => {
            console.log("On Error - Expected behavior:", error.message);
            console.log("Error code:", error.code);

            // Verify we got the expected error
            if (error.code === 'PROCESS_DOWN') {
                console.log("✅ SUCCESS: Received expected PROCESS_DOWN error");
                console.log("✅ ServerlessId:", error.serverlessId);
                testFinished();
                testFinished();
            } else {
                console.log("❌ UNEXPECTED: Got different error code:", error.code);
                console.error(error);
                testFinished();
            }
        });

        // Simulate process crash after a short delay to trigger error
        setTimeout(() => {
            console.log("🔥 Simulating serverless process crash...");
            if (serverlessAPI && serverlessAPI.process && !serverlessAPI.process.killed) {
                console.log("Killing serverless process with PID:", serverlessAPI.process.pid);
                serverlessAPI.process.kill('SIGTERM');
            } else {
                console.log("Process already dead or not found");
            }
        }, 2000); // Kill process after 2 seconds
    });
}, 50000);