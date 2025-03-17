const DelayedResponse = require('./DelayedResponse');
const InternalService = require('./InternalService').getInstance();
const InternalWebhook = require('./InternalWebhook').getInstance();

// Get the webhook URL from environment variables
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:8090/webhook/result';

// Optional: Set up an HTTP client for webhook if needed to post results directly
const http = require('http');
const url = require('url');

/**
 * AsyncPlugin - Plugin implementation that uses the internal service for async operations
 */
function AsyncPlugin() {
    /**
     * Authorization method (required by CoreContainer)
     * @param {string} asUser - User attempting to execute the operation
     * @returns {boolean} Whether the user is allowed to execute operations
     */
    this.allow = function (asUser) {
        // In a real implementation, we would check if the user has permissions
        // For this mock, always return true
        return true;
    };

    /**
     * Process data asynchronously
     * @param {Object} data - Data to process
     * @returns {string} Call ID for tracking the operation
     */
    this.processDataAsync = async function (data) {
        console.log(`AsyncPlugin: processDataAsync called with data:`, data);
        console.log(`Using webhook URL: ${WEBHOOK_URL}`);

        // Create a DelayedResponse to track progress
        const delayedResponse = new DelayedResponse((progressUpdate) => {
            // When the internal service reports progress or completion,
            // this callback will be invoked

            if (progressUpdate.status === 'completed') {
                // When the operation is complete, store the result in the webhook
                InternalWebhook.storeResult(delayedResponse.getCallId(), progressUpdate.result);

                // Optionally post directly to the webhook URL for redundancy
                postResultToWebhook(delayedResponse.getCallId(), progressUpdate.result);
            }
        });

        // Start the internal service operation without awaiting its completion
        InternalService.processOperation('processData', data, (update) => {
            if (update.status === 'in_progress') {
                delayedResponse.updateProgress(update.progress, `Processing data: ${update.progress}%`);
            } else if (update.status === 'completed') {
                delayedResponse.complete(update.result);
            } else if (update.status === 'failed') {
                delayedResponse.fail(new Error(update.error || 'Operation failed'));
            }
        });

        // Return just the call ID immediately
        return delayedResponse.getCallId();
    };

    /**
     * Generate report asynchronously
     * @param {Object} parameters - Report parameters
     * @returns {string} Call ID for tracking the operation
     */
    this.generateReportAsync = async function (parameters) {
        console.log(`AsyncPlugin: generateReportAsync called with parameters:`, parameters);
        console.log(`Using webhook URL: ${WEBHOOK_URL}`);

        const delayedResponse = new DelayedResponse((progressUpdate) => {
            if (progressUpdate.status === 'completed') {
                InternalWebhook.storeResult(delayedResponse.getCallId(), progressUpdate.result);

                // Also post directly to the webhook URL
                postResultToWebhook(delayedResponse.getCallId(), progressUpdate.result);
            }
        });

        InternalService.processOperation('generateReport', parameters, (update) => {
            if (update.status === 'in_progress') {
                delayedResponse.updateProgress(update.progress, `Generating report: ${update.progress}%`);
            } else if (update.status === 'completed') {
                delayedResponse.complete(update.result);
            } else if (update.status === 'failed') {
                delayedResponse.fail(new Error(update.error || 'Report generation failed'));
            }
        });

        return delayedResponse.getCallId();
    };

    /**
     * Helper function to post results directly to the webhook URL
     * @param {string} callId - Call ID
     * @param {object} result - Result data
     * @private
     */
    const postResultToWebhook = (callId, result) => {
        try {
            const parsedUrl = url.parse(WEBHOOK_URL);
            const webhookStoreUrl = WEBHOOK_URL.replace('/result', '/store');

            console.log(`Posting result for ${callId} to webhook: ${webhookStoreUrl}`);

            // Create the request data
            const postData = JSON.stringify({ callId, result });

            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || 80,
                path: '/webhook/store',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = http.request(options, (res) => {
                console.log(`Webhook response status: ${res.statusCode}`);

                let responseData = '';
                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        console.error(`Webhook error: ${responseData}`);
                    } else {
                        console.log(`Webhook success: ${responseData}`);
                    }
                });
            });

            req.on('error', (error) => {
                console.error(`Error posting to webhook: ${error.message}`);
            });

            req.write(postData);
            req.end();
        } catch (error) {
            console.error(`Failed to post to webhook: ${error.message}`);
        }
    };

    /**
     * Generic operation that happens to be async
     * @param {string} operationType - Type of operation to execute
     * @param {Object} params - Operation parameters
     * @returns {string} Call ID for tracking the operation
     */
    this.genericOperation = async function (operationType, params) {
        console.log(`AsyncPlugin: genericOperation called with operation: ${operationType}`, params);
        console.log(`Using webhook URL: ${WEBHOOK_URL}`);

        const delayedResponse = new DelayedResponse((progressUpdate) => {
            if (progressUpdate.status === 'completed') {
                InternalWebhook.storeResult(delayedResponse.getCallId(), progressUpdate.result);

                // Also post directly to the webhook URL
                postResultToWebhook(delayedResponse.getCallId(), progressUpdate.result);
            }
        });

        InternalService.processOperation(operationType, params, (update) => {
            if (update.status === 'in_progress') {
                delayedResponse.updateProgress(update.progress, `Operation ${operationType}: ${update.progress}%`);
            } else if (update.status === 'completed') {
                delayedResponse.complete(update.result);
            } else if (update.status === 'failed') {
                delayedResponse.fail(new Error(update.error || 'Operation failed'));
            }
        });

        return delayedResponse.getCallId();
    };

    /**
     * Direct synchronous operation (for comparison)
     * @returns {string} Simple message
     */
    this.syncOperation = function () {
        console.log("AsyncPlugin: syncOperation called");
        return "This is a synchronous operation response";
    };
}

function getName() {
    return "AsyncPlugin";
}

function getDependencies() {
    return []; // No dependencies for this plugin
}

function getInstance() {
    return new AsyncPlugin();
}

function getAllow() {
    return function(forWhom, name) {
        return true; // For testing, allow all operations
    };
}

module.exports = {
    getName,
    getDependencies,
    getInstance,
    getAllow
};