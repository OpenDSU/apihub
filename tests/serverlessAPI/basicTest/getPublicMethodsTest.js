require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const dc = require("double-check");
const { assert } = dc;
const path = require("path");
const fs = require("fs");

assert.callback("Test ServerlessClient getPublicMethods method", async (testFinished) => {
    dc.createTestFolder('getPublicMethods', async (err, folder) => {
        if (err) {
            console.error("Error creating test folder:", err);
            return testFinished(err);
        }

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
        const result = await tir.launchApiHubTestNodeAsync({ rootFolder: folder });
        const server = result.node;

        const apiHub = require('apihub');
        const secretsService = await apiHub.getSecretsServiceInstanceAsync(folder);
        const testEnvVars = {
            TEST_VAR1: "test_value1",
            TEST_VAR2: "test_value2"
        };
        const serverlessId = "test-getPublicMethods";
        await secretsService.putSecretsAsync(serverlessId, testEnvVars);

        const serverlessAPI = await server.createServerlessAPI({
            urlPrefix: serverlessId,
            storage: folder
        });

        server.registerServerlessProcess(serverlessId, serverlessAPI);

        const { createServerlessAPIClient } = require("opendsu").loadAPI("serverless");

        // Create clients for both plugins
        const defaultClient = await createServerlessAPIClient("admin", result.url, serverlessId, "DefaultMockPlugin");
        const runtimeClient = await createServerlessAPIClient("admin", result.url, serverlessId, "RuntimeMockPlugin");

        // Test getPublicMethods for DefaultMockPlugin
        console.log("Testing getPublicMethods for DefaultMockPlugin...");
        const defaultPluginMethods = await defaultClient.getPublicMethods();

        // Verify it returns an array
        assert.true(Array.isArray(defaultPluginMethods), "getPublicMethods should return an array");

        // Verify it includes the expected methods
        assert.true(defaultPluginMethods.includes("helloWorld"), "Should include 'helloWorld' method");
        assert.true(defaultPluginMethods.includes("hello"), "Should include 'hello' method");
        assert.true(defaultPluginMethods.includes("getEnvironmentVariable"), "Should include 'getEnvironmentVariable' method");

        // Verify the count is correct
        assert.true(defaultPluginMethods.length === 3, `Expected 3 methods, got ${defaultPluginMethods.length}`);

        console.log("DefaultMockPlugin methods:", defaultPluginMethods);

        // Test getPublicMethods for RuntimeMockPlugin
        console.log("Testing getPublicMethods for RuntimeMockPlugin...");
        const runtimePluginMethods = await runtimeClient.getPublicMethods();

        // Verify it returns an array
        assert.true(Array.isArray(runtimePluginMethods), "getPublicMethods should return an array");

        // Verify it includes the expected methods
        assert.true(runtimePluginMethods.includes("helloWorld"), "Should include 'helloWorld' method");
        assert.true(runtimePluginMethods.includes("hello"), "Should include 'hello' method");

        // Verify the count is correct
        assert.true(runtimePluginMethods.length === 2, `Expected 2 methods, got ${runtimePluginMethods.length}`);

        console.log("RuntimeMockPlugin methods:", runtimePluginMethods);

        // Verify that the methods are different between plugins
        assert.true(defaultPluginMethods.length !== runtimePluginMethods.length,
            "Different plugins should have different method counts");

        // Verify that both plugins have common methods
        const commonMethods = defaultPluginMethods.filter(method =>
            runtimePluginMethods.includes(method)
        );
        assert.true(commonMethods.includes("helloWorld"), "Both plugins should have 'helloWorld' method");
        assert.true(commonMethods.includes("hello"), "Both plugins should have 'hello' method");

        console.log("All getPublicMethods tests passed!");
        testFinished();
    });
}, 30000); 