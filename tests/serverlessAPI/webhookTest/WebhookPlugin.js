const http = require('http');
const https = require('https');
const crypto = require('crypto');
function WebhookPlugin() {
    const webhooks = new Map();

    // Generate a unique webhook ID
    function generateWebhookId() {
        return crypto.randomBytes(32).toString('base64url');
    }

    this.allow = function (asUser) {
        return true;
    }

    this.start = async function () {
        console.log("Starting WebhookPlugin...");
    }

    this.stop = async function () {
        console.log("Stopping WebhookPlugin...");
        webhooks.clear();
    }

    this.registerWebhook = async function (url, events) {
        if (!url || typeof url !== 'string') {
            throw new Error("Webhook URL is required");
        }

        if (!Array.isArray(events) || events.length === 0) {
            throw new Error("Events must be a non-empty array");
        }

        const webhookId = generateWebhookId();

        webhooks.set(webhookId, {
            url,
            events,
            createdAt: Date.now(),
            deliveries: [],
            stats: {
                success: 0,
                failure: 0,
                lastDeliveryAttempt: null
            }

        });

        console.log(`Registered webhook ${webhookId} for URL ${url} and events: ${events.join(', ')}`);
        return webhookId;
    }

    this.updateWebhook = async function (webhookId, url, events) {
        if (!webhooks.has(webhookId)) {
            throw new Error(`Webhook ${webhookId} not found`);
        }

        if (!url || typeof url !== 'string') {
            throw new Error("Webhook URL is required");
        }

        if (!Array.isArray(events) || events.length === 0) {
            throw new Error("Events must be a non-empty array");
        }

        const webhook = webhooks.get(webhookId);
        webhook.url = url;
        webhook.events = events;
        webhook.updatedAt = Date.now();

        console.log(`Updated webhook ${webhookId} for URL ${url} and events: ${events.join(', ')}`);
        return true;
    }

    this.unregisterWebhook = async function (webhookId) {
        const result = webhooks.delete(webhookId);
        console.log(`Unregistered webhook ${webhookId}, success: ${result}`);
        return result;
    }


    this.getWebhookDeliveryStatus = async function (webhookId) {
        if (!webhooks.has(webhookId)) {
            throw new Error(`Webhook ${webhookId} not found`);
        }

        const webhook = webhooks.get(webhookId);

        return {
            id: webhookId,
            url: webhook.url,
            events: webhook.events,
            stats: webhook.stats,
            deliveries: webhook.deliveries.slice(-10)
        };
    }

    this.triggerEvent = async function (eventType, eventData) {
        console.log(`Event triggered: ${eventType}, data: ${JSON.stringify(eventData)}`);

        const eventId = crypto.randomBytes(32).toString("base64url");
        const timestamp = new Date().toISOString();

        // Prepare webhook payload
        const payload = {
            id: eventId,
            timestamp,
            event: eventType,
            data: eventData
        };

        // Track which webhooks will be notified
        const notifiedWebhooks = [];

        // Find all webhooks subscribed to this event type
        for (let [webhookId, webhook] of webhooks.entries()) {
            if (webhook.events.includes(eventType)) {
                notifiedWebhooks.push(webhookId);

                // Fire the webhook (don't await - we want to fire them in parallel)
                await sendWebhook(webhookId, webhook, payload);
            }
        }

        return {
            eventId,
            eventType,
            notifiedWebhooks
        };
    }

    async function sendWebhook(webhookId, webhook, payload) {
        const deliveryId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const startTime = Date.now();

        console.log(`Sending webhook ${deliveryId} to ${webhook.url}`);

        // Create delivery record
        const delivery = {
            id: deliveryId,
            webhookId,
            eventId: payload.id,
            eventType: payload.event,
            url: webhook.url,
            timestamp: new Date().toISOString(),
            status: 'pending',
            startTime,
            endTime: null,
            duration: null,
            responseStatus: null,
            responseBody: null,
            error: null
        };

        try {
            // Prepare the webhook data
            const webhookData = JSON.stringify(payload);

            // Determine if this is HTTP or HTTPS
            const isHttps = webhook.url.startsWith('https://');
            const httpModule = isHttps ? https : http;

            // Parse the URL to get host, port, and path
            const url = new URL(webhook.url);

            const options = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(webhookData),
                    'User-Agent': 'WebhookPlugin/1.0',
                    'X-Webhook-ID': webhookId,
                    'X-Delivery-ID': deliveryId
                }
            };

            // Send the request
            const response = await new Promise((resolve, reject) => {
                const req = httpModule.request(options, (res) => {
                    let responseBody = '';

                    res.on('data', (chunk) => {
                        responseBody += chunk;
                    });

                    res.on('end', () => {
                        resolve({
                            statusCode: res.statusCode,
                            body: responseBody
                        });
                    });
                });

                req.on('error', (error) => {
                    reject(error);
                });

                // Write data to request body
                req.write(webhookData);
                req.end();
            });

            // Update delivery record with success
            const endTime = Date.now();
            delivery.endTime = endTime;
            delivery.duration = endTime - startTime;
            delivery.status = response.statusCode >= 200 && response.statusCode < 300 ? 'success' : 'failure';
            delivery.responseStatus = response.statusCode;
            delivery.responseBody = response.body;

            // Update webhook stats
            webhook.stats.lastDeliveryAttempt = new Date().toISOString();
            if (delivery.status === 'success') {
                webhook.stats.success++;
            } else {
                webhook.stats.failure++;
            }

            console.log(`Webhook ${deliveryId} delivered with status ${delivery.status}, response: ${response.statusCode}`);
        } catch (error) {
            // Update delivery record with failure
            const endTime = Date.now();
            delivery.endTime = endTime;
            delivery.duration = endTime - startTime;
            delivery.status = 'error';
            delivery.error = error.message;

            // Update webhook stats
            webhook.stats.lastDeliveryAttempt = new Date().toISOString();
            webhook.stats.failure++;

            console.error(`Webhook ${deliveryId} delivery failed:`, error);
        }

        // Store the delivery record
        webhook.deliveries.push(delivery);

        // Limit the number of stored deliveries to the most recent 100
        if (webhook.deliveries.length > 100) {
            webhook.deliveries = webhook.deliveries.slice(-100);
        }

        return delivery;
    }
}

module.exports = {
    getInstance: async () => {
        return new WebhookPlugin();
    }
};