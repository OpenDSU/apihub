require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const dc = require("double-check");
const {assert} = dc;
const path = require("path");
const fs = require("fs");

assert.callback("Test serverless API with slow initialization", async (testFinished) => {
    dc.createTestFolder('serverlessAPI', async (err, folder) => {
        // Create plugins directory
        const pluginsDir = path.join(folder, 'plugins');
        fs.mkdirSync(pluginsDir, { recursive: true });
        
        // Create files that require the plugins
        const slowInitPluginSrc = path.join(__dirname, "SlowInitPlugin.js");
        const slowInitPluginContent = `module.exports = require("${slowInitPluginSrc}");`;
        fs.writeFileSync(path.join(pluginsDir, "SlowInitPlugin.js"), slowInitPluginContent);

        // Launch API Hub test node
        const result = await tir.launchApiHubTestNodeAsync({rootFolder: folder});
        const server = result.node;
        const serverlessId = "test";
        
        // Create serverless API with the folder containing plugin structure
        const serverlessAPI = await server.createServerlessAPI({
            urlPrefix: serverlessId,
            storage: folder
        });
        
        // Initialize plugins from the directory structure
        server.registerServerlessProcess(serverlessId, serverlessAPI);

        const {createServerlessAPIClient} = require("opendsu").loadAPI("serverless");

        // Test SlowInitPlugin (should take ~3 seconds to initialize)
        console.log("Creating client for SlowInitPlugin...");
        const startTime = Date.now();
        const slowInitClient = await createServerlessAPIClient("admin", result.url, serverlessId, "SlowInitPlugin");
        const slowInitTime = Date.now() - startTime;
        
        // Verify that the client waited for the plugin to initialize
        assert.true(slowInitTime >= 3000, `Expected initialization to take at least 3 seconds, but took ${slowInitTime}ms`);
        
        // Test the plugin functionality
        let res = await slowInitClient.helloWorld();
        assert.true(res === "Hello World from SlowInitPlugin!", `Expected "Hello World from SlowInitPlugin!", got "${res}"`);

        testFinished();
    });
}, 15000);