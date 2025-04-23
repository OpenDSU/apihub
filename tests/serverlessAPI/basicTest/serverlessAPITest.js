require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const dc = require("double-check");
const {assert} = dc;
const path = require("path");
const fs = require("fs");

assert.callback("Test serverless API", async (testFinished) => {
    dc.createTestFolder('serverlessAPI', async (err, folder) => {
        process.env.SSO_SECRETS_ENCRYPTION_KEY = "QJvA2CnpD7NTXWDWmm754KY4x6fyxVOk/1r3N0z8NQA=";
        // Create plugins directory
        const pluginsDir = path.join(folder, 'plugins');
        fs.mkdirSync(pluginsDir, { recursive: true });
        
        // Create files that require the original plugins
        const defaultPluginSrc = path.join(__dirname, "DefaultMockPlugin.js");
        const runtimePluginSrc = path.join(__dirname, "RuntimeMockPlugin.js");
        
        const defaultPluginContent = `module.exports = require("${defaultPluginSrc}");`;
        const runtimePluginContent = `module.exports = require("${runtimePluginSrc}");`;
        
        fs.writeFileSync(path.join(pluginsDir, "DefaultMockPlugin.js"), defaultPluginContent);
        fs.writeFileSync(path.join(pluginsDir, "RuntimeMockPlugin.js"), runtimePluginContent);
        
        // Launch API Hub test node
        const result = await tir.launchApiHubTestNodeAsync({rootFolder: folder});
        const server = result.node;
        // process.env.SSO_SECRETS_ENCRYPTION_KEY = require("crypto").randomBytes(32).toString("base64");
        const apiHub = require('apihub');
        const secretsService = await apiHub.getSecretsServiceInstanceAsync(folder);
        const testEnvVars = {
            TEST_VAR1: "test_value1",
            TEST_VAR2: "test_value2"
        };
        await secretsService.putSecretsAsync('env', testEnvVars);
        
        const serverlessId = "test";
        
        // Create serverless API with the folder containing plugin structure
        const serverlessAPI = await server.createServerlessAPI({
            urlPrefix: serverlessId,
            storage: folder // Pass the root folder to the serverless API
        });
        
        server.registerServerlessProcess(serverlessId, serverlessAPI);

        const {createServerlessAPIClient} = require("opendsu").loadAPI("serverless");
        const defaultClient = await createServerlessAPIClient("admin", result.url, serverlessId, "DefaultMockPlugin");

        // Test DefaultMockPlugin (should be loaded first due to dependencies)
        let res = await defaultClient.helloWorld();
        assert.true(res === "Hello World Core1!", `Expected "Hello World Core1!", got "${res}"`);
        
        res = await defaultClient.hello();
        assert.true(res === "Hello Core1!", `Expected "Hello Core1!", got "${res}"`);
        
        // Create enhanced client for RuntimeMockPlugin
        const runtimeClient = await createServerlessAPIClient("admin", result.url, serverlessId, "RuntimeMockPlugin");
        
        // Test RuntimeMockPlugin (depends on DefaultMockPlugin)
        res = await runtimeClient.helloWorld();
        assert.true(res === "Hello World Core2!", `Expected "Hello World Core2!", got "${res}"`);
        
        res = await runtimeClient.hello();
        assert.true(res === "Hello Core2!", `Expected "Hello Core2!", got "${res}"`);

        // Test environment variables were properly set
        // You may need to add methods to your plugins to verify the environment variables
        // For example:
        res = await defaultClient.getEnvironmentVariable('TEST_VAR1');
        assert.true(res === "test_value1", `Expected "test_value1", got "${res}"`);

        testFinished();
    })
}, 50000);
