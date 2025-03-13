const http = require('http');
const url = require('url');
const InternalWebhook = require('./InternalWebhook').getInstance();

/**
 * WebhookServer - HTTP server that exposes the InternalWebhook for polling
 */
class WebhookServer {
    constructor(port = 8090) {
        this.port = port;
        this.server = null;
    }

    /**
     * Start the webhook server
     * @returns {Promise} Promise that resolves when server is started
     */
    start() {
        return new Promise((resolve, reject) => {
            if (this.server) {
                return resolve({ port: this.port });
            }

            this.server = http.createServer((req, res) => {
                this._handleRequest(req, res);
            });

            this.server.on('error', (err) => {
                console.error('WebhookServer error:', err);
                reject(err);
            });

            this.server.listen(this.port, () => {
                console.log(`WebhookServer running on port ${this.port}`);

                // Log all available results for debugging
                setInterval(() => {
                    const results = InternalWebhook.getAllResults();
                    if (results.length > 0) {
                        console.log(`WebhookServer: Currently stored results: ${results.length}`);
                        results.forEach(result => {
                            console.log(`  - Call ID: ${result.callId}, Age: ${result.age}s`);
                        });
                    }
                }, 5000);

                resolve({ port: this.port });
            });
        });
    }

    /**
     * Handle incoming HTTP requests
     * @param {http.IncomingMessage} req - HTTP request
     * @param {http.ServerResponse} res - HTTP response
     * @private
     */
    _handleRequest(req, res) {
        const parsedUrl = url.parse(req.url, true);
        const path = parsedUrl.pathname;
        const query = parsedUrl.query;

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        // Handle preflight requests
        if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            return res.end();
        }

        // Route requests based on path and method
        if (path === '/webhook/result' && req.method === 'GET') {
            this._handleResultRequest(query, res);
        } else if (path === '/webhook/status' && req.method === 'GET') {
            this._handleStatusRequest(res);
        } else if (path === '/webhook/store' && req.method === 'POST') {
            this._handleStoreRequest(req, res);
        } else {
            // Log the received request for debugging
            console.log(`Webhook received request: ${req.method} ${path}`);

            res.statusCode = 404;
            res.end(JSON.stringify({
                error: 'Not found',
                message: `No handler for ${req.method} ${path}`
            }));
        }
    }

    /**
     * Handle requests for operation results
     * @param {Object} query - URL query parameters
     * @param {http.ServerResponse} res - HTTP response
     * @private
     */
    _handleResultRequest(query, res) {
        res.setHeader('Content-Type', 'application/json');

        if (!query.callId) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: 'Missing callId parameter' }));
        }

        console.log(`Webhook: Received request for result of call ${query.callId}`);

        const result = InternalWebhook.getResult(query.callId);

        if (result) {
            console.log(`Webhook: Found result for call ${query.callId}`);
            res.statusCode = 200;
            res.end(JSON.stringify({ status: 'completed', result }));
        } else {
            console.log(`Webhook: No result found yet for call ${query.callId}`);
            res.statusCode = 200; // Still return 200, just indicate no result yet
            res.end(JSON.stringify({ status: 'pending', message: 'Result not available yet' }));
        }
    }

    /**
     * Handle requests for server status
     * @param {http.ServerResponse} res - HTTP response
     * @private
     */
    _handleStatusRequest(res) {
        res.setHeader('Content-Type', 'application/json');

        const status = {
            uptime: process.uptime(),
            resultsCount: InternalWebhook.getAllResults().length,
            timestamp: new Date().toISOString()
        };

        res.statusCode = 200;
        res.end(JSON.stringify(status));
    }

    /**
     * Handle POST requests to store results directly
     * @param {http.IncomingMessage} req - HTTP request
     * @param {http.ServerResponse} res - HTTP response
     * @private
     */
    _handleStoreRequest(req, res) {
        let body = '';

        req.on('data', (chunk) => {
            body += chunk.toString();
        });

        req.on('end', () => {
            res.setHeader('Content-Type', 'application/json');

            try {
                const data = JSON.parse(body);

                if (!data.callId) {
                    res.statusCode = 400;
                    return res.end(JSON.stringify({ error: 'Missing callId parameter' }));
                }

                if (!data.result) {
                    res.statusCode = 400;
                    return res.end(JSON.stringify({ error: 'Missing result parameter' }));
                }

                InternalWebhook.storeResult(data.callId, data.result);

                res.statusCode = 200;
                res.end(JSON.stringify({ success: true, message: 'Result stored successfully' }));
            } catch (error) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid JSON data', message: error.message }));
            }
        });
    }

    /**
     * Stop the webhook server
     * @returns {Promise} Promise that resolves when server is stopped
     */
    stop() {
        return new Promise((resolve, reject) => {
            if (!this.server) {
                return resolve();
            }

            this.server.close((err) => {
                if (err) {
                    return reject(err);
                }
                this.server = null;
                console.log('WebhookServer stopped');
                resolve();
            });
        });
    }

    /**
     * Get the webhook URL
     * @returns {string} The webhook URL
     */
    getUrl() {
        return `http://localhost:${this.port}/webhook`;
    }
}

module.exports = WebhookServer;