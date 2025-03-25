require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const path = require("path");
const dc = require("double-check");
const {assert} = dc;
const fs = require('fs');
const SlowLambdaClientResponse = require('../../../../opendsu/serverless/SlowLambdaClientResponse');

assert.callback("Test Serverless API Async Flow", async (testFinished) => {
    dc.createTestFolder('serverlessAPIAsync', async (err, folder) => {
        const result = await tir.launchApiHubTestNodeAsync({rootFolder: folder});
        const server = result.node;

        const serverlessId = "test";
        const pluginsDir = path.join(folder, 'plugins');
        fs.mkdirSync(pluginsDir, {recursive: true});

        const asyncPluginSrc = path.join(__dirname, "SlowLambdaPlugin.js");
        const asyncPluginDest = path.join(pluginsDir, "SlowLambdaPlugin.js");
        fs.copyFileSync(asyncPluginSrc, asyncPluginDest);

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
        
        const {createServerlessAPIClient} = require("opendsu").loadAPI("serverless");

        const client = createServerlessAPIClient("admin", result.url, serverlessId, "SlowLambdaPlugin", `${result.url}/webhook`);
        const fastResponse = await client.fastOperationTest();
        console.log(fastResponse);

        const slowResponse = client.processDataAsyncTest();
        console.log('Response type:', slowResponse.constructor.name);
        console.log('Response properties:', Object.keys(slowResponse));
        console.log('Is Promise?', slowResponse instanceof Promise);
        console.log('Is SlowLambdaClientResponse?', slowResponse instanceof SlowLambdaClientResponse);

        slowResponse.onProgress((progress) => {
            console.log("On Progress", progress);
        });
        
        const res = await slowResponse;
        console.log(res);
        testFinished();
    });
}, 50000);