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
                WEBHOOK_URL: `${result.url}/webhook`
            }
        });

        const serverUrl = serverlessAPI.getUrl();
        console.log(`Serverless API started at ${serverUrl}`);
        server.registerServerlessProcessUrl(serverlessId, serverUrl);

        const { createServerlessAPIClient } = require("opendsu").loadAPI("serverless");

        const client = await createServerlessAPIClient("admin", result.url, serverlessId, "SlowLambdaPlugin");
        const fastResponse = await client.fastOperationTest();
        console.log(fastResponse);

        const slowResponse = client.processDataAsyncTest()
        slowResponse.onProgress((progress) => {
            console.log("On Progress", progress);
        });

        slowResponse.then((result) => {
            console.log("On End", result);
            testFinished();
        });
    });
}, 50000);