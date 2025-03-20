/**
 * InternalWebhook - Handles storing and retrieving results of completed operations
 */
class InternalWebhook {
    constructor() {
        this.results = new Map();
        this.expirationTime = 60 * 1000; // Results expire after 1 minute
        this.cleanupInterval = setInterval(() => this._cleanupExpiredResults(), 30000);
    }

    /**
     * Store the result of a completed operation
     * @param {string} callId - The call ID associated with the result
     * @param {Object} result - The operation result
     */
    storeResult(callId, result) {
        console.log(`InternalWebhook: Storing result for call ${callId}`);
        this.results.set(callId, {
            callId,
            result,
            timestamp: Date.now()
        });

        // Log the current state of results for debugging
        const resultCount = this.results.size;
        console.log(`InternalWebhook: Currently storing ${resultCount} results`);
        return true;
    }

    /**
     * Get the result for a specific call ID
     * @param {string} callId - The call ID to retrieve results for
     * @returns {Object|null} The result or null if not found
     */
    getResult(callId) {
        console.log(`InternalWebhook: Looking up result for call ${callId}`);
        const storedResult = this.results.get(callId);
        if (!storedResult) {
            console.log(`InternalWebhook: No result found for call ${callId}`);
            return null;
        }

        // Check if result has expired
        if (Date.now() - storedResult.timestamp > this.expirationTime) {
            console.log(`InternalWebhook: Result for call ${callId} has expired`);
            this.results.delete(callId);
            return null;
        }

        console.log(`InternalWebhook: Found result for call ${callId}`);
        return storedResult.result;
    }

    /**
     * Get all results (useful for debugging)
     * @returns {Array} Array of all stored results
     */
    getAllResults() {
        const resultsList = [];
        for (const [callId, data] of this.results.entries()) {
            resultsList.push({
                callId,
                data: data.result,
                age: (Date.now() - data.timestamp) / 1000 // age in seconds
            });
        }
        return resultsList;
    }

    /**
     * Remove expired results
     * @private
     */
    _cleanupExpiredResults() {
        const now = Date.now();
        const expiredCallIds = [];

        for (const [callId, data] of this.results.entries()) {
            if (now - data.timestamp > this.expirationTime) {
                expiredCallIds.push(callId);
            }
        }

        for (const callId of expiredCallIds) {
            console.log(`InternalWebhook: Removing expired result for call ${callId}`);
            this.results.delete(callId);
        }
    }
}

// Singleton instance
let instance = null;

/**
 * Get the InternalWebhook instance
 */
function getInstance() {
    if (!instance) {
        instance = new InternalWebhook();
    }
    return instance;
}

module.exports = {
    getInstance
};