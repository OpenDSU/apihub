require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const dc = require("double-check");
const {assert} = dc;
const path = require("path");
const fs = require("fs");

assert.callback("Test serverless API restart functionality", async (testFinished) => {
    dc.createTestFolder('serverlessAPI', async (err, folder) => {
        // Set encryption key for SecretsService
        process.env.SSO_SECRETS_ENCRYPTION_KEY = "QJvA2CnpD7NTXWDWmm754KY4x6fyxVOk/1r3N0z8NQA=";
        
        // Create plugins directory
        const pluginsDir = path.join(folder, 'plugins');
        fs.mkdirSync(pluginsDir, { recursive: true });
        
        const defaultPluginSrc = path.join(__dirname, "DefaultMockPlugin.js");
        const runtimePluginSrc = path.join(__dirname, "RuntimeMockPlugin.js");

        const defaultPluginContent = `module.exports = require("${defaultPluginSrc}");`;
        const runtimePluginContent = `module.exports = require("${runtimePluginSrc}");`;

        fs.writeFileSync(path.join(pluginsDir, "DefaultMockPlugin.js"), defaultPluginContent);
        fs.writeFileSync(path.join(pluginsDir, "RuntimeMockPlugin.js"), runtimePluginContent);

        // Launch API Hub test node
        const result = await tir.launchApiHubTestNodeAsync({rootFolder: folder});
        const server = result.node;

        // Initialize SecretsService and store initial environment variables
        const apiHub = require('apihub');
        const secretsService = await apiHub.getSecretsServiceInstanceAsync(folder);
        const initialEnvVars = {
            INTERNAL_WEBHOOK_URL: `${result.url}/internalWebhook/result`,
            INITIAL_VAR: "initial_value"
        };
        await secretsService.putSecretsAsync('env', initialEnvVars);
        
        const serverlessId = "test";
        
        // Create serverless API without explicitly providing env variables
        const serverlessAPI = await server.createServerlessAPI({
            urlPrefix: serverlessId,
            storage: folder
        });
        
        // Initialize plugins from the directory structure
        server.registerServerlessProcess(serverlessId, serverlessAPI);
        
        const {createServerlessAPIClient} = require("opendsu").loadAPI("serverless");
        const defaultClient = await createServerlessAPIClient("admin", result.url, serverlessId, "DefaultMockPlugin");
        const runtimeClient = await createServerlessAPIClient("admin", result.url, serverlessId, "RuntimeMockPlugin");

        // Test initial state
        let res = await defaultClient.helloWorld();
        assert.true(res === "Hello World Core1!", `Expected "Hello World Core1!", got "${res}"`);
        
        res = await runtimeClient.helloWorld();
        assert.true(res === "Hello World Core2!", `Expected "Hello World Core2!", got "${res}"`);

        const initialDefaultEnvResult = await defaultClient.getEnvironmentVariable("INITIAL_VAR");
        assert.true(initialDefaultEnvResult === "initial_value", `Expected "initial_value", got "${initialDefaultEnvResult}"`);

        const runtimeInitialEnvResult = await runtimeClient.getEnvironmentVariable("INTERNAL_WEBHOOK_URL");
        assert.true(runtimeInitialEnvResult === `${result.url}/internalWebhook/result`, `Expected "INTERNAL_WEBHOOK_URL" to be "${result.url}/internalWebhook/result", got "${runtimeInitialEnvResult}"`);

        // Update environment variables in SecretsService
        const newEnvVars = {
            NEW_VAR: "new_value",
            INITIAL_VAR: "updated_value"
        };
        await secretsService.putSecretsAsync('env', newEnvVars);

        // Start multiple concurrent requests that will be queued during restart
        const concurrentRequests = [
            defaultClient.helloWorld(),
            runtimeClient.helloWorld(),
            defaultClient.hello(),
            runtimeClient.hello()
        ];

        // Call restart endpoint without providing env variables (should use SecretsService)
        const response = await fetch(`${result.url}/proxy/setEnv/${serverlessId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            }
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

        // Test that environment variables were updated from SecretsService
        const envResponse = await runtimeClient.getEnvironmentVariable("NEW_VAR");
        assert.true(envResponse === "new_value", `Expected "new_value", got "${envResponse}"`);
        testFinished();
    });
}, 50000); 