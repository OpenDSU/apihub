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
        const corePath = path.join(__dirname, "MockCore.js");
        const serverlessAPI = server.createServerlessAPI({urlPrefix, corePath});
        const serverUrl = serverlessAPI.getUrl();
        const serverlessAPIProxy = server.createServerlessAPIProxy(serverUrl);
        const ServerlessAPIClient = require("../../serverlessAPIClient");
        const interfaceDefinition = [ "helloWorld", "hello" ];
        const client = require("opendsu").loadAPI("serverless").createServerlessAPIClient(`${serverUrl}/executeCommand`, interfaceDefinition);
        console.log(client.helloWorld());
        console.log(client.hello());
    })
}, 50000);