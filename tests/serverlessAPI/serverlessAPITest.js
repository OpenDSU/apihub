require("../../../../builds/output/testsRuntime");
const tir = require("../../../../psknode/tests/util/tir");
const dc = require("double-check");
const {assert} = dc;
const path = require("path");

assert.callback("Test serverless API", async (testFinished) => {
    dc.createTestFolder('serverlessAPI', async (err, folder) => {
        const result = await tir.launchApiHubTestNodeAsync({rootFolder: folder});
        const server = result.node;
        const urlPrefix = "/test";
        const coreConfig = {};
        const corePath1 = path.join(__dirname, "MockCore1.js");
        const corePath2 = path.join(__dirname, "MockCore2.js");
        const namespace1 = "MockCore1";
        const namespace2 = "MockCore2";
        const coreConfigs = {};
        coreConfigs[namespace1] = {
            corePath: corePath1,
            coreConfig
        };
        coreConfigs[namespace2] = {
            corePath: corePath2,
            coreConfig
        };
        const serverlessAPI = server.createServerlessAPI({urlPrefix, coreConfigs});
        const serverUrl = serverlessAPI.getUrl();
        const serverlessAPIProxy = server.createServerlessAPIProxy(serverUrl);
        const interfaceDefinition = ["helloWorld", "hello"];
        let client = require("opendsu").loadAPI("serverless").createServerlessAPIClient("admin", serverUrl, namespace1, interfaceDefinition);
        let res = await client.helloWorld();
        assert.true(res === "Hello World Core1!");
        res = await client.hello();
        assert.true(res === "Hello Core1!");
        client = require("opendsu").loadAPI("serverless").createServerlessAPIClient("admin", serverUrl, namespace2, interfaceDefinition);
        res = await client.helloWorld();
        assert.true(res === "Hello World Core2!");
        res = await client.hello();
        assert.true(res === "Hello Core2!");
        server.close();
        testFinished();
        console.log("======>>>>>>>>>>")
    })
}, 50000);
