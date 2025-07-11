function WebhookProgressTracker() {
    const progressStorage = {};
    let results = {};
    let expiryTime = {};
    let expiryCallbacks = {};
    const DEFAULT_EXPIRY_TIME = parseInt(process.env.WEBHOOK_EXPIRY_TIME) || 5 * 60 * 1000;
    const DEBUG_MODE = process.env.WEBHOOK_DEBUG === 'true';

    const debugLog = (message) => {
        if (DEBUG_MODE) {
            console.log(message);
        }
    };

    this.setExpiryTime = (callId, time) => {
        expiryTime[callId] = time;
    }

    this.onExpiry = (callId, callback) => {
        expiryCallbacks[callId] = callback;
        console.log(`[WEBHOOK] Registered expiry callback for callId: ${callId.substring(0, 8)}...`);
        debugLog(`[DEBUG] Registered expiry callback for callId: ${callId}`);
    }

    this.storeProgress = (callId, progress) => {
        if (!progressStorage[callId]) {
            progressStorage[callId] = [];
        }
        const timestamp = Date.now();
        progressStorage[callId].push({ progress, timestamp });

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
        const timestamp = Date.now();
        results[callId] = { result, timestamp };
        // Set default expiry time if not set
        if (!expiryTime[callId]) {
            expiryTime[callId] = DEFAULT_EXPIRY_TIME;
        }

        debugLog(`[DEBUG] Stored result for callId: ${callId}, timestamp: ${timestamp}, expiry: ${expiryTime[callId]}ms`);
    }

    this.getResult = (callId) => {
        if (!results[callId]) {
            return undefined;
        }
        return results[callId].result;
    }

    this.cleanupCallId = (callId) => {
        const hasData = progressStorage[callId] || results[callId] || expiryTime[callId] || expiryCallbacks[callId];

        if (hasData) {
            console.log(`[WEBHOOK] Cleaned up callId: ${callId.substring(0, 8)}...`);
            debugLog(`[DEBUG] Cleaning up callId: ${callId}`);
            delete progressStorage[callId];
            delete results[callId];
            delete expiryTime[callId];
            delete expiryCallbacks[callId];
        } else {
            debugLog(`[DEBUG] CallId ${callId} already cleaned up, skipping`);
        }
    }

    this.triggerCleanup = () => {
        removeExpiredProgressAndResults();
    }

    const removeExpiredProgressAndResults = () => {
        const currentTime = Date.now();
        const expiredCallIds = new Set();

        const activeCallIds = new Set([
            ...Object.keys(progressStorage),
            ...Object.keys(results),
            ...Object.keys(expiryCallbacks)
        ]);

        console.log(`[WEBHOOK] Cleanup cycle: ${activeCallIds.size} active callIds (progress: ${Object.keys(progressStorage).length}, results: ${Object.keys(results).length}, callbacks: ${Object.keys(expiryCallbacks).length})`);

        // Check each callId for expiry based on most recent activity
        for (const callId of activeCallIds) {
            const expiryTimeout = expiryTime[callId] || DEFAULT_EXPIRY_TIME;
            let mostRecentActivity = 0;
            let hasActiveData = false;

            // Check progress entries
            if (progressStorage[callId] && progressStorage[callId].length > 0) {
                const progressArray = progressStorage[callId];
                const latestProgress = Math.max(...progressArray.map(entry => entry.timestamp));
                mostRecentActivity = Math.max(mostRecentActivity, latestProgress);
                hasActiveData = true;

                // Clean up old progress entries but keep the most recent ones
                const validProgress = progressArray.filter(entry =>
                    currentTime - entry.timestamp <= expiryTimeout
                );

                if (validProgress.length < progressArray.length) {
                    progressStorage[callId] = validProgress;
                    debugLog(`[DEBUG] CallId ${callId}: removed ${progressArray.length - validProgress.length} old progress entries`);
                }

                if (validProgress.length === 0) {
                    delete progressStorage[callId];
                }
            }

            // Check result entries
            if (results[callId]) {
                mostRecentActivity = Math.max(mostRecentActivity, results[callId].timestamp);
                hasActiveData = true;
            }

            // Determine if callId has expired
            if (hasActiveData && mostRecentActivity > 0) {
                const age = currentTime - mostRecentActivity;
                if (age > expiryTimeout) {
                    expiredCallIds.add(callId);
                    console.log(`[WEBHOOK] CallId ${callId} expired after ${Math.round(age / 1000)}s (threshold: ${Math.round(expiryTimeout / 1000)}s)`);
                }
            } else if (expiryCallbacks[callId]) {
                expiredCallIds.add(callId);
            }
        }

        if (expiredCallIds.size > 0) {
            console.log(`[WEBHOOK] Processing ${expiredCallIds.size} expired callIds`);
            for (const callId of expiredCallIds) {
                // Call expiry callback if set (webhook server side cleanup)
                if (expiryCallbacks[callId]) {
                    console.log(`[WEBHOOK] Triggering expiry callback for callId: ${callId}`);
                    try {
                        expiryCallbacks[callId](callId);
                    } catch (error) {
                        console.error(`[WEBHOOK] Error in expiry callback for ${callId}:`, error);
                    }
                }

                // Clean up webhook data for this callId
                this.cleanupCallId(callId);
            }
        }
    }

    const CLEANUP_INTERVAL = parseInt(process.env.WEBHOOK_CLEANUP_INTERVAL) || 30000;
    console.log(`[WEBHOOK] Expiry tracker initialized - cleanup every ${CLEANUP_INTERVAL / 1000}s, expiry after ${DEFAULT_EXPIRY_TIME / 1000}s`);
    setInterval(removeExpiredProgressAndResults, CLEANUP_INTERVAL);
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
