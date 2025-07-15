function WebhookProgressTracker() {
    const progressStorage = {};
    let results = {};
    let expiryTime = {};
    let expiryCallbacks = {};
    let callbackRegistrationTime = {}; // Track when callbacks were registered
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
        callbackRegistrationTime[callId] = Date.now(); // Track when callback was registered

        // Set registration timestamp to track when the callId was first registered
        if (!expiryTime[callId]) {
            expiryTime[callId] = DEFAULT_EXPIRY_TIME;
        }

        // Track when this callId was registered if no data exists yet
        if (!progressStorage[callId] && !results[callId]) {
            // Create an initial timestamp to track when this callId became active
            const timestamp = Date.now();
            if (!progressStorage[callId]) {
                progressStorage[callId] = [];
            }
            // Add a placeholder entry to track the registration time
            progressStorage[callId].push({ progress: null, timestamp, isRegistration: true });
        }
    }

    this.storeProgress = (callId, progress) => {
        if (!progressStorage[callId]) {
            progressStorage[callId] = [];
        }
        const timestamp = Date.now();
        progressStorage[callId].push({ progress, timestamp });

        if (!expiryTime[callId]) {
            expiryTime[callId] = DEFAULT_EXPIRY_TIME;
        }
    }

    this.getProgress = (callId) => {
        if (typeof progressStorage[callId] === 'undefined' || progressStorage[callId].length === 0) {
            return undefined;
        }
        const realProgress = progressStorage[callId].filter(entry => !entry.isRegistration);
        if (realProgress.length === 0) {
            return undefined;
        }
        return realProgress[0].progress;
    }

    this.consumeProgress = (callId) => {
        if (typeof progressStorage[callId] === 'undefined' || progressStorage[callId].length === 0) {
            return undefined;
        }

        const realProgressIndex = progressStorage[callId].findIndex(entry => !entry.isRegistration);
        if (realProgressIndex === -1) {
            return undefined;
        }

        const progress = progressStorage[callId].splice(realProgressIndex, 1)[0].progress;

        const hasRealProgress = progressStorage[callId].some(entry => !entry.isRegistration);
        if (!hasRealProgress) {
            const registrationEntries = progressStorage[callId].filter(entry => entry.isRegistration);
            if (registrationEntries.length === 0) {
                delete progressStorage[callId];
            } else {
                progressStorage[callId] = registrationEntries;
            }
        }

        return progress;
    }

    this.storeResult = (callId, result) => {
        const timestamp = Date.now();
        results[callId] = { result, timestamp };
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
        const hasData = progressStorage[callId] || results[callId] || expiryTime[callId] || expiryCallbacks[callId] || callbackRegistrationTime[callId];

        if (hasData) {
            delete progressStorage[callId];
            delete results[callId];
            delete expiryTime[callId];
            delete expiryCallbacks[callId];
            delete callbackRegistrationTime[callId];
        }
    }

    this.cleanupCallIdsForUnavailableProcess = (serverlessId) => {
        const activeCallIds = new Set([
            ...Object.keys(progressStorage),
            ...Object.keys(results),
            ...Object.keys(expiryCallbacks),
            ...Object.keys(callbackRegistrationTime)
        ]);

        let cleanedCount = 0;
        for (const callId of activeCallIds) {
            const callIdServerlessId = this.getServerlessIdForCallId ? this.getServerlessIdForCallId(callId) : null;

            if (callIdServerlessId === serverlessId) {
                if (expiryCallbacks[callId]) {
                    console.log(`[WEBHOOK] Triggering expiry callback for callId: ${callId} (process unavailable)`);
                    try {
                        expiryCallbacks[callId](callId);
                    } catch (error) {
                        console.error(`[WEBHOOK] Error in expiry callback for ${callId}:`, error);
                    }
                }

                this.cleanupCallId(callId);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`[WEBHOOK] Cleaned up ${cleanedCount} callIds for unavailable serverless process: ${serverlessId}`);
        }
    }

    this.setServerlessIdMapping = (mappingFunction) => {
        this.getServerlessIdForCallId = mappingFunction;
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
            ...Object.keys(expiryCallbacks),
            ...Object.keys(callbackRegistrationTime)
        ]);

        for (const callId of activeCallIds) {
            const expiryTimeout = expiryTime[callId] || DEFAULT_EXPIRY_TIME;
            let mostRecentActivity = 0;
            let hasActiveData = false;

            if (progressStorage[callId] && progressStorage[callId].length > 0) {
                const progressArray = progressStorage[callId];
                const latestProgress = Math.max(...progressArray.map(entry => entry.timestamp));
                mostRecentActivity = Math.max(mostRecentActivity, latestProgress);

                const hasRealProgress = progressArray.some(entry => !entry.isRegistration);
                if (hasRealProgress) {
                    hasActiveData = true;
                }

                const validProgress = progressArray.filter(entry =>
                    currentTime - entry.timestamp <= expiryTimeout
                );

                if (validProgress.length < progressArray.length) {
                    progressStorage[callId] = validProgress;
                }

                if (validProgress.length === 0) {
                    delete progressStorage[callId];
                }
            }

            if (results[callId]) {
                mostRecentActivity = Math.max(mostRecentActivity, results[callId].timestamp);
                hasActiveData = true;
            }

            if (hasActiveData && mostRecentActivity > 0) {
                const age = currentTime - mostRecentActivity;
                if (age > expiryTimeout) {
                    expiredCallIds.add(callId);
                }
            } else if (expiryCallbacks[callId] && !hasActiveData) {
                let registrationTimestamp = null;

                if (progressStorage[callId] && progressStorage[callId].length > 0) {
                    const registrationEntry = progressStorage[callId].find(entry => entry.isRegistration);
                    if (registrationEntry) {
                        registrationTimestamp = registrationEntry.timestamp;
                    }
                }

                if (!registrationTimestamp && callbackRegistrationTime[callId]) {
                    registrationTimestamp = callbackRegistrationTime[callId];
                }

                if (registrationTimestamp) {
                    const age = currentTime - registrationTimestamp;
                    if (age > expiryTimeout) {
                        expiredCallIds.add(callId);
                    }
                }
            }
        }

        if (expiredCallIds.size > 0) {
            for (const callId of expiredCallIds) {
                if (expiryCallbacks[callId]) {
                    try {
                        expiryCallbacks[callId](callId);
                    } catch (error) {
                        console.error(`[WEBHOOK] Error in expiry callback for ${callId}:`, error);
                    }
                }

                this.cleanupCallId(callId);
            }
        }
    }

    this.startCleanupInterval = () => {
        if (!this.cleanupIntervalId) {
            const CLEANUP_INTERVAL = parseInt(process.env.WEBHOOK_CLEANUP_INTERVAL) || 30000;
            console.log(`[WEBHOOK] Expiry tracker initialized - cleanup every ${CLEANUP_INTERVAL / 1000}s, expiry after ${DEFAULT_EXPIRY_TIME / 1000}s`);
            this.cleanupIntervalId = setInterval(removeExpiredProgressAndResults, CLEANUP_INTERVAL);
        }
    };

    this.stopCleanupInterval = () => {
        if (this.cleanupIntervalId) {
            clearInterval(this.cleanupIntervalId);
            this.cleanupIntervalId = null;
        }
    };
}

let instance;
let cleanupInterval = null;

module.exports = {
    getInstance: () => {
        if (!instance) {
            console.log(`[WEBHOOK] Creating InternalWebhookProgressTracker instance in main ApiHub process`);
            instance = new WebhookProgressTracker();

            if (!cleanupInterval) {
                const CLEANUP_INTERVAL = parseInt(process.env.WEBHOOK_CLEANUP_INTERVAL) || 30000;
                const DEFAULT_EXPIRY_TIME = parseInt(process.env.WEBHOOK_EXPIRY_TIME) || 5 * 60 * 1000;
                console.log(`[WEBHOOK] Starting global cleanup interval - every ${CLEANUP_INTERVAL / 1000}s, expiry after ${DEFAULT_EXPIRY_TIME / 1000}s`);

                cleanupInterval = setInterval(() => {
                    if (instance) {
                        instance.triggerCleanup();
                    }
                }, CLEANUP_INTERVAL);
            }
        }
        return instance;
    },

    destroyInstance: () => {
        if (cleanupInterval) {
            clearInterval(cleanupInterval);
            cleanupInterval = null;
        }
        instance = null;
    }
};
