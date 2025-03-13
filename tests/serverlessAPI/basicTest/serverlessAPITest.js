require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const dc = require("double-check");
const {assert} = dc;
const path = require("path");

assert.callback("Test serverless API", async (testFinished) => {
    dc.createTestFolder('serverlessAPI', async (err, folder) => {
        const result = await tir.launchApiHubTestNodeAsync({rootFolder: folder});
        const server = result.node;
        const serverlessId = "test";
        const coreConfig = {};
        const corePath1 = path.join(__dirname, "DefaultMockPlugin.js");
        const corePath2 = path.join(__dirname, "RuntimeMockPlugin.js");
        const namespace1 = "DefaultMockPlugin";
        const namespace2 = "RuntimeMockPlugin";
        const coreConfigs = {};
        coreConfigs[namespace1] = {
            corePath: corePath1,
            coreConfig
        };
        coreConfigs[namespace2] = {
            corePath: corePath2,
            coreConfig
        };
        const serverlessAPI = await server.createServerlessAPI({urlPrefix: serverlessId, coreConfigs});
        
        const serverUrl = serverlessAPI.getUrl();
        server.registerServerlessProcessUrl(serverlessId, serverUrl);
        // const serverlessAPIProxy = await server.createServerlessAPIProxy(serverUrl);
        const methods = server.getRegisteredMiddlewareFunctions();
        let client = require("opendsu").loadAPI("serverless").createServerlessAPIClient("admin", `${result.url}/proxy`, serverlessId, namespace1);
        await client.registerPlugin(namespace1, corePath1);
        let res = await client.helloWorld();
        assert.true(res === "Hello World Core1!");
        res = await client.hello();
        assert.true(res === "Hello Core1!");
        client = require("opendsu").loadAPI("serverless").createServerlessAPIClient("admin", `${result.url}/proxy`, serverlessId, namespace2);
        await client.registerPlugin(namespace2, corePath2);
        res = await client.helloWorld();
        assert.true(res === "Hello World Core2!");
        res = await client.hello();
        assert.true(res === "Hello Core2!");
        server.close();
        testFinished();
        console.log("======>>>>>>>>>>")
    })
}, 50000);
