const InternalService = require('./InternalService').getInstance();

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
        console.log(`Using webhook URL: ${process.env.WEBHOOK_URL}`);

        // Get a DelayedResponse from the internal service
        const delayedResponse = InternalService.processOperation('processData', data);

        // Set up a progress callback to store results in the webhook
        delayedResponse.progressCallback = (progressUpdate) => {
            if (progressUpdate.status === 'completed') {
                // When the operation is complete, store the result in the webhook
                postResultToWebhook(delayedResponse.getCallId(), progressUpdate.result);
            }
        };

        return delayedResponse;
    };

    /**
     * Generate report asynchronously
     * @param {Object} parameters - Report parameters
     * @returns {string} Call ID for tracking the operation
     */
    this.generateReportAsync = async function (parameters) {
        console.log(`AsyncPlugin: generateReportAsync called with parameters:`, parameters);
        console.log(`Using webhook URL: ${process.env.WEBHOOK_URL}`);

        // Get a DelayedResponse from the internal service
        const delayedResponse = InternalService.processOperation('generateReport', parameters);

        // Set up a progress callback to store results in the webhook
        delayedResponse.progressCallback = (progressUpdate) => {
            if (progressUpdate.status === 'completed') {
                postResultToWebhook(delayedResponse.getCallId(), progressUpdate.result);
            }
        };

        return delayedResponse;
    };

    /**
     * Helper function to post results directly to the webhook URL
     * @param {string} callId - Call ID
     * @param {object} result - Result data
     * @private
     */
    const postResultToWebhook = (callId, result) => {
        try {
            const parsedUrl = url.parse(process.env.WEBHOOK_URL);
            const webhookStoreUrl = process.env.WEBHOOK_URL.replace('/result', '/store');

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
        console.log(`Using webhook URL: ${process.env.WEBHOOK_URL}`);

        // Get a DelayedResponse from the internal service
        const delayedResponse = InternalService.processOperation(operationType, params);

        // Set up a progress callback to store results in the webhook
        delayedResponse.progressCallback = (progressUpdate) => {
            if (progressUpdate.status === 'completed') {
                postResultToWebhook(delayedResponse.getCallId(), progressUpdate.result);
            }
        };

        return delayedResponse;
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
    getDependencies,
    getInstance,
    getAllow
};