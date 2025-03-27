require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const dc = require("double-check");
const {assert} = dc;
const path = require("path");
const fs = require("fs");

assert.callback("Test serverless API restart functionality", async (testFinished) => {
    dc.createTestFolder('serverlessAPI', async (err, folder) => {
        // Create plugins directory
        const pluginsDir = path.join(folder, 'plugins');
        fs.mkdirSync(pluginsDir, { recursive: true });
        
        // Copy plugin files directly to the plugins directory
        const defaultPluginSrc = path.join(__dirname, "DefaultMockPlugin.js");
        const runtimePluginSrc = path.join(__dirname, "RuntimeMockPlugin.js");
        
        const defaultPluginDest = path.join(pluginsDir, "DefaultMockPlugin.js");
        const runtimePluginDest = path.join(pluginsDir, "RuntimeMockPlugin.js");
        
        fs.copyFileSync(defaultPluginSrc, defaultPluginDest);
        fs.copyFileSync(runtimePluginSrc, runtimePluginDest);
        
        // Launch API Hub test node
        const result = await tir.launchApiHubTestNodeAsync({rootFolder: folder});
        const server = result.node;
        const serverlessId = "test";
        
        // Create serverless API with the folder containing plugin structure
        const serverlessAPI = await server.createServerlessAPI({
            urlPrefix: serverlessId,
            storage: folder,
            env: {
                WEBHOOK_URL: `${result.url}/webhook/result`,
                INITIAL_VAR: "initial_value"
            }
        });
        
        // Initialize plugins from the directory structure
        const serverUrl = serverlessAPI.getUrl();
        server.registerServerlessProcessUrl(serverlessId, serverUrl);
        
        const {createServerlessAPIClient} = require("opendsu").loadAPI("serverless");
        const defaultClient = await createServerlessAPIClient("admin", result.url, serverlessId, "DefaultMockPlugin");
        const runtimeClient = await createServerlessAPIClient("admin", result.url, serverlessId, "RuntimeMockPlugin");

        // Test initial state
        let res = await defaultClient.helloWorld();
        assert.true(res === "Hello World Core1!", `Expected "Hello World Core1!", got "${res}"`);
        
        res = await runtimeClient.helloWorld();
        assert.true(res === "Hello World Core2!", `Expected "Hello World Core2!", got "${res}"`);

        // Test restart with new environment variables
        const newEnvVars = {
            NEW_VAR: "new_value",
            INITIAL_VAR: "updated_value"
        };

        // Start multiple concurrent requests that will be queued during restart
        const concurrentRequests = [
            defaultClient.helloWorld(),
            runtimeClient.helloWorld(),
            defaultClient.hello(),
            runtimeClient.hello()
        ];

        // Call restart endpoint with new environment variables
        const response = await fetch(`${serverUrl}/restart`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newEnvVars)
        });

        assert.true(response.status === 200, `Expected status 200, got ${response.status}`);
        const responseBody = await response.json();
        assert.true(responseBody.statusCode === 200, `Expected statusCode 200, got ${responseBody.statusCode}`);

        // Wait for all queued requests to complete
        const results = await Promise.all(concurrentRequests);
        
        // Verify all queued requests executed successfully after restart
        assert.true(results[0] === "Hello World Core1!", `Expected "Hello World Core1!", got "${results[0]}"`);
        assert.true(results[1] === "Hello World Core2!", `Expected "Hello World Core2!", got "${results[1]}"`);
        assert.true(results[2] === "Hello Core1!", `Expected "Hello Core1!", got "${results[2]}"`);
        assert.true(results[3] === "Hello Core2!", `Expected "Hello Core2!", got "${results[3]}"`);

        // Verify plugins still work after restart with new requests
        res = await defaultClient.helloWorld();
        assert.true(res === "Hello World Core1!", `Expected "Hello World Core1!", got "${res}"`);
        
        res = await runtimeClient.helloWorld();
        assert.true(res === "Hello World Core2!", `Expected "Hello World Core2!", got "${res}"`);

        // Test that environment variables were updated
        const envResponse = await fetch(`${serverUrl}/executeCommand`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                forWhom: "admin",
                name: "getEnv",
                pluginName: "DefaultMockPlugin",
                args: ["NEW_VAR", "INITIAL_VAR"]
            })
        });

        const envResult = await envResponse.json();
        assert.true(envResult.statusCode === 200, `Expected statusCode 200, got ${envResult.statusCode}`);
        assert.true(envResult.result.NEW_VAR === "new_value", `Expected "new_value", got "${envResult.result.NEW_VAR}"`);
        assert.true(envResult.result.INITIAL_VAR === "updated_value", `Expected "updated_value", got "${envResult.result.INITIAL_VAR}"`);

        testFinished();
    });
}, 50000); 