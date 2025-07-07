function WebhookProgressTracker() {
    const progressStorage = {};
    let results = {};
    let expiryTime = {};

    this.setExpiryTime = (callId, time) => {
        expiryTime[callId] = time;
    }

    this.storeProgress = (callId, progress) => {
        progressStorage[callId] = {progress, timestamp: Date.now()};
    }

    this.getProgress = (callId) => {
        if (typeof progressStorage[callId] === 'undefined') {
            return undefined;
        }
        let progress = progressStorage[callId].progress;
        delete progressStorage[callId];
        return progress;
    }

    this.storeResult = (callId, result) => {
        results[callId] = {result, timestamp: Date.now()};
    }

    this.getResult = (callId) => {
        if (!results[callId]) {
            return undefined;
        }
        return results[callId].result;
    }

    const removeExpiredProgressAndResults = () => {
        const currentTime = Date.now();
        for (const callId in progressStorage) {
            if (currentTime - progressStorage[callId].front().timestamp > expiryTime[callId]) {
                progressStorage[callId].pop();
            }
        }
        for (const callId in results) {
            if (currentTime - results[callId].timestamp > expiryTime[callId]) {
                delete results[callId];
            }
        }
    }

    // setInterval(removeExpiredProgressAndResults, 1000);
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
