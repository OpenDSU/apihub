require("../../../../../builds/output/testsRuntime");
const tir = require("../../../../../psknode/tests/util/tir");
const dc = require("double-check");
const {assert} = dc;
const path = require("path");
const fetch = require("node-fetch"); // Make sure to have node-fetch installed

// Define the path to the NotificationsPlugin
const notificationsPluginPath = path.join(__dirname, "NotificationsPlugin.js");

assert.callback("Test serverless API with SSE notifications", async (testFinished) => {
    dc.createTestFolder('serverlessAPINotifications', async (err, folder) => {
        // Launch API Hub Test Node
        const result = await tir.launchApiHubTestNodeAsync({rootFolder: folder});
        const server = result.node;
        const urlPrefix = "/test";
        // Set up plugin configuration
        const namespace = "NotificationsPlugin";

        try {
            // Create serverless API
            const serverlessAPI = await server.createServerlessAPI({urlPrefix});
            const serverUrl = serverlessAPI.getUrl();

            // Create client for the plugin
            let client = require("opendsu").loadAPI("serverless").createServerlessAPIClient("admin", serverUrl, namespace);

            // Register plugin
            await client.registerPlugin(namespace, notificationsPluginPath);

            console.log("Starting SSE notifications test...");

            // Set up an EventSource to listen for notifications
            // We need to simulate this since we can't directly use EventSource in Node.js
            // This is where the client would listen for notifications
            const notificationsReceived = [];
            const expectedNotifications = 5;

            // Create a function to collect notifications using HTTP requests
            // Start the notification stream on the server
            const subscriptionId = await client.subscribeToNotifications("admin");
            assert.true(subscriptionId && typeof subscriptionId === 'string',
                "Should receive a valid subscription ID");

            console.log(`Received subscription ID: ${subscriptionId}`);

            // Trigger an action that will generate notifications
            await client.triggerNotifications(expectedNotifications, 500); // 5 notifications, 500ms apart

            // Poll for notifications (in a real client, this would be handled by EventSource)
            let attempts = 0;
            const maxAttempts = 20;

            while (notificationsReceived.length < expectedNotifications && attempts < maxAttempts) {
                attempts++;
                try {
                    // Poll for new notifications
                    const notifications = await client.getNotifications(subscriptionId);

                    if (notifications && Array.isArray(notifications) && notifications.length > 0) {
                        // Add any new notifications to our collection
                        notifications.forEach(notification => {
                            if (!notificationsReceived.some(n => n.id === notification.id)) {
                                notificationsReceived.push(notification);
                                console.log(`Received notification: ${JSON.stringify(notification)}`);
                            }
                        });
                    }

                    // Wait before polling again
                    await new Promise(resolve => setTimeout(resolve, 300));
                } catch (error) {
                    console.error("Error polling for notifications:", error);
                }
            }

            // Verify we received the expected number of notifications
            assert.true(notificationsReceived.length === expectedNotifications,
                `Should receive ${expectedNotifications} notifications, but got ${notificationsReceived.length}`);

            // Verify notification contents
            for (let i = 0; i < notificationsReceived.length; i++) {
                assert.true(notificationsReceived[i].message.includes(`Notification ${i+1}`),
                    `Notification ${i+1} should contain the correct message`);
            }

            // Unsubscribe from notifications
            const unsubscribeResult = await client.unsubscribeFromNotifications(subscriptionId);
            assert.true(unsubscribeResult === true, "Should successfully unsubscribe");

            console.log("SSE notifications test passed");

            // Close server
            server.close();
            testFinished();
        } catch (error) {
            console.error("Test failed with error:", error);
            server.close();
            testFinished(error);
        }
    });
}, 60000);