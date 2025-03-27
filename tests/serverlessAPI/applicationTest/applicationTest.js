require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const dc = require("double-check");
const {assert} = dc;
const path = require("path");
const fs = require("fs");

assert.callback("Test serverless API", async (testFinished) => {
    dc.createTestFolder('serverlessAPI', async (err, folder) => {
        if (err) {
            throw err;
        }

        const srcPluginFolder = path.join(__dirname, './appCode/plugins');
        const destPluginFolder = path.join(folder, 'plugins');
        const srcDepsFolder = path.join(__dirname, './appCode/deps');
        const destDepsFolder = path.join(folder, 'deps');

        // Create plugins directory
        fs.mkdirSync(destPluginFolder, { recursive: true });
        fs.mkdirSync(destDepsFolder, { recursive: true });

        // Copy plugin files directly to the plugins directory
        fs.readdirSync(srcPluginFolder).forEach(file => {
            const srcFile = path.join(srcPluginFolder, file);
            const destFile = path.join(destPluginFolder, file);
            fs.copyFileSync(srcFile, destFile);
        });

        // Copy dependency files directly to the deps directory
        fs.readdirSync(srcDepsFolder).forEach(file => {
            const srcFile = path.join(srcDepsFolder, file);
            const destFile = path.join(destDepsFolder, file);
            fs.copyFileSync(srcFile, destFile);
        });

        // check if the plugins and deps were copied
        const destPluginFiles = fs.readdirSync(destPluginFolder);
        const destDepsFiles = fs.readdirSync(destDepsFolder);
        assert.true(destPluginFiles.length > 0, 'No plugin files copied');
        assert.true(destDepsFiles.length > 0, 'No dependency files copied');

        // Launch API Hub test node
        const result = await tir.launchApiHubTestNodeAsync({rootFolder: folder});
        const server = result.node;
        const serverlessId = "test";

        // Create serverless API with the folder containing plugin structure
        const serverlessAPI = await server.createServerlessAPI({
            port: 9091,
            urlPrefix: serverlessId,
            storage: folder // Pass the root folder to the serverless API
        });

        // Initialize plugins from the directory structure
        const serverUrl = serverlessAPI.getUrl();
        server.registerServerlessProcessUrl(serverlessId, serverUrl);

        try {
            // Create and initialize BasePlugin client
            const {createServerlessAPIClient} = require("opendsu").loadAPI("serverless");
            let client = await createServerlessAPIClient("admin", result.url, serverlessId, "BasePlugin");
            
            // Test BasePlugin
            let res = await client.hello();
            console.log("BasePlugin response:", res);
            assert.true(res === "Hello from BasePlugin!", `Expected "Hello from BasePlugin!", got "${res}"`);

            // Create and initialize FeaturesPlugin client
            client = await createServerlessAPIClient("admin", result.url, serverlessId, "FeaturesPlugin");
            
            // Test FeaturesPlugin
            res = await client.hello();
            console.log("FeaturesPlugin response:", res);
            assert.true(res === "Hello from BasePlugin! And hello from FeaturesPlugin!", 
                `Expected "Hello from BasePlugin! And hello from FeaturesPlugin!", got "${res}"`);

            // Test error handling
            try {
                await client.nonexistentMethod();
                assert.true(false, "Should have thrown an error for nonexistent method");
            } catch (error) {
                assert.true(error.message.includes("HTTP error!"), 
                    `Expected error about method not found, got "${error.message}"`);
            }

            testFinished();
        } catch (error) {
            console.error("Test failed:", error);
            throw error;
        }
    });
}, 50000);