function WebhookProgressTracker() {
    const progressStorage = {};
    let results = {};
    let expiryTime = {};
    let expiryCallbacks = {};
    const DEFAULT_EXPIRY_TIME = 3 * 60 * 1000; // 3 minutes

    this.setExpiryTime = (callId, time) => {
        expiryTime[callId] = time;
    }

    this.onExpiry = (callId, callback) => {
        expiryCallbacks[callId] = callback;
    }

    this.storeProgress = (callId, progress) => {
        if (!progressStorage[callId]) {
            progressStorage[callId] = [];
        }
        progressStorage[callId].push({ progress, timestamp: Date.now() });

        // Set default expiry time if not set
        if (!expiryTime[callId]) {
            expiryTime[callId] = DEFAULT_EXPIRY_TIME;
        }
    }

    this.getProgress = (callId) => {
        if (typeof progressStorage[callId] === 'undefined' || progressStorage[callId].length === 0) {
            return undefined;
        }
        // Return the first progress without consuming it
        return progressStorage[callId][0].progress;
    }

    this.consumeProgress = (callId) => {
        if (typeof progressStorage[callId] === 'undefined' || progressStorage[callId].length === 0) {
            return undefined;
        }
        let progress = progressStorage[callId].shift().progress;
        if (progressStorage[callId].length === 0) {
            delete progressStorage[callId];
        }
        return progress;
    }

    this.storeResult = (callId, result) => {
        results[callId] = { result, timestamp: Date.now() };
        // Set default expiry time if not set
        if (!expiryTime[callId]) {
            expiryTime[callId] = DEFAULT_EXPIRY_TIME;
        }
    }

    this.getResult = (callId) => {
        if (!results[callId]) {
            return undefined;
        }
        return results[callId].result;
    }

    this.cleanupCallId = (callId) => {
        delete progressStorage[callId];
        delete results[callId];
        delete expiryTime[callId];
        delete expiryCallbacks[callId];
    }

    const removeExpiredProgressAndResults = () => {
        const currentTime = Date.now();
        const expiredCallIds = new Set();

        // Check for expired progress entries
        for (const [callId, progressArray] of Object.entries(progressStorage)) {
            const expiryTimeout = expiryTime[callId] || DEFAULT_EXPIRY_TIME;
            const validProgress = progressArray.filter(entry =>
                currentTime - entry.timestamp <= expiryTimeout
            );

            if (validProgress.length === 0) {
                // All progress entries expired
                expiredCallIds.add(callId);
                delete progressStorage[callId];
            } else if (validProgress.length < progressArray.length) {
                // Some progress entries expired, keep only valid ones
                progressStorage[callId] = validProgress;
            }
        }

        // Check for expired result entries
        for (const [callId, resultData] of Object.entries(results)) {
            const expiryTimeout = expiryTime[callId] || DEFAULT_EXPIRY_TIME;
            if (currentTime - resultData.timestamp > expiryTimeout) {
                expiredCallIds.add(callId);
            }
        }

        // Handle expired callIds
        for (const callId of expiredCallIds) {
            // Call expiry callback if set
            if (expiryCallbacks[callId]) {
                expiryCallbacks[callId](callId);
            }

            // Clean up all data for this callId
            this.cleanupCallId(callId);
        }
    }

    // Enable cleanup every 30 seconds
    setInterval(removeExpiredProgressAndResults, 30000);
}

let instance;

module.exports = {
    getInstance: () => {
        if (!instance) {
            instance = new WebhookProgressTracker();
        }
        return instance;
    }
};
