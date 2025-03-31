require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const dc = require("double-check");
const {assert} = dc;
const path = require("path");
const http = require("http");
const {createApiHubInstanceWorkerAsync} = require("../../../../../psknode/tests/util/ApiHubTestNodeLauncher/launcher-utils");

// Define the path to the WebhookPlugin
const webhookPluginPath = path.join(__dirname, "WebhookPlugin.js");

assert.callback("Test serverless API with webhook integration", async (testFinished) => {
    dc.createTestFolder('serverlessAPIWebhooks', async (err, folder) => {
        // Create a simple webhook receiver server
        const webhookPort = 8090;
        const webhookHost = "localhost";
        let receivedWebhooks = [];

        const webhookServer = http.createServer((req, res) => {
            if (req.method === 'POST' && req.url === '/internalWebhook') {
                let body = '';
                req.on('data', chunk => {
                    body += chunk.toString();
                });
                req.on('end', () => {
                    try {
                        const webhookData = JSON.parse(body);
                        console.log(`Webhook receiver got: ${JSON.stringify(webhookData)}`);
                        receivedWebhooks.push(webhookData);
                        res.statusCode = 200;
                        res.end(JSON.stringify({ success: true }));
                    } catch (e) {
                        console.error("Failed to parse webhook data:", e);
                        res.statusCode = 400;
                        res.end(JSON.stringify({ success: false, error: "Invalid data format" }));
                    }
                });
            } else {
                res.statusCode = 404;
                res.end();
            }
        });

        webhookServer.listen(webhookPort, webhookHost, () => {
            console.log(`Webhook receiver server running at http://${webhookHost}:${webhookPort}/`);
        });

        const config = {
            rootFolder: folder,
            activeComponents: ["webhookComponent"],
            "componentsConfig": {
                "webhookComponent": {
                    "module": path.join(__dirname, "mockWebhookComponent.js")
                }
            }
        }

        const getReceivedWebhooks = async (webhookUrl) => {
            const response = await fetch(webhookUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch received webhooks: ${response.statusText}`);
            }
            const data = await response.json();
            return data;
        }

        try {
            // Launch API Hub Test Node
            const result = await tir.launchApiHubTestNodeAsync(config);
            const server = result.node;
            const urlPrefix = "/test";
            // Set up plugin configuration
            const namespace = "WebhookPlugin";
            // Create serverless API
            const serverlessAPI = await server.createServerlessAPI({urlPrefix});
            const serverUrl = serverlessAPI.getUrl();

            // Create client for the plugin
            let client = require("opendsu").loadAPI("serverless").createServerlessAPIClient("admin", serverUrl, namespace);

            // Register plugin
            await client.registerPlugin(namespace, webhookPluginPath);

            console.log("Starting webhook integration test...");

            // Register a webhook endpoint
            const webhookUrl = `http://${webhookHost}:${webhookPort}/internalWebhook`;
            const events = ["event.created", "event.updated", "event.deleted"];
            const webhookId = await client.registerWebhook(webhookUrl, events);

            assert.true(webhookId && typeof webhookId === 'string',
                "Should receive a valid webhook ID");

            console.log(`Registered webhook with ID: ${webhookId} for events: ${events.join(", ")}`);

            // Trigger events that should fire the webhook
            console.log("Triggering events...");
            await client.triggerEvent("event.created", { id: "123", name: "Test Event" });
            await client.triggerEvent("event.updated", { id: "123", name: "Updated Test Event" });
            await client.triggerEvent("different.event", { id: "456" });

            // Give some time for webhooks to be received
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Test webhook delivery
            assert.true(receivedWebhooks.length === 2,
                `Should receive exactly 2 webhooks, but received ${receivedWebhooks.length}`);

            // Verify webhook content
            assert.true(receivedWebhooks[0].event === "event.created",
                `First webhook should be for event.created, but was ${receivedWebhooks[0].event}`);

            assert.true(receivedWebhooks[1].event === "event.updated",
                `Second webhook should be for event.updated, but was ${receivedWebhooks[1].event}`);

            // Test webhook delivery status
            const deliveryStatus = await client.getWebhookDeliveryStatus(webhookId);

            assert.true(Array.isArray(deliveryStatus.deliveries) && deliveryStatus.deliveries.length >= 2,
                "Should have a record of webhook deliveries");

            assert.true(deliveryStatus.stats.success >= 2,
                `Should have at least 2 successful deliveries, but had ${deliveryStatus.stats.success}`);

            // Test updating webhook subscription
            const newEvents = ["event.deleted"];
            const updateResult = await client.updateWebhook(webhookId, webhookUrl, newEvents);

            assert.true(updateResult === true, "Should successfully update webhook");

            // Trigger events after update to verify only subscribed events fire
            receivedWebhooks = []; // Clear previous webhooks

            await client.triggerEvent("event.created", { id: "789" }); // Should no longer trigger
            await client.triggerEvent("event.deleted", { id: "123" }); // Should trigger

            // Give some time for webhooks to be received
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Verify only the event.deleted webhook was received
            assert.true(receivedWebhooks.length === 1,
                `Should receive exactly 1 webhook after update, but received ${receivedWebhooks.length}`);

            if (receivedWebhooks.length > 0) {
                assert.true(receivedWebhooks[0].event === "event.deleted",
                    `Webhook should be for event.deleted, but was ${receivedWebhooks[0].event}`);
            }

            // Test unregistering webhook
            const unregisterResult = await client.unregisterWebhook(webhookId);

            assert.true(unregisterResult === true, "Should successfully unregister webhook");

            // Trigger events after unregistering to verify no more webhooks are sent
            receivedWebhooks = []; // Clear previous webhooks
            const response = await fetch(webhookUrl)
            await client.triggerEvent("event.deleted", { id: "123" }); // Should no longer trigger

            // Give some time to ensure no webhooks are received
            await new Promise(resolve => setTimeout(resolve, 2000));

            assert.true(receivedWebhooks.length === 0,
                `Should receive 0 webhooks after unregistering, but received ${receivedWebhooks.length}`);

            console.log("Webhook integration test passed");
            testFinished();
        } catch (error) {
            console.error("Test failed with error:", error);
            testFinished(error);
        }
    });
}, 60000); // Increase timeout to 60 seconds