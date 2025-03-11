function LongRunningPlugin() {
    this.allow = function (asUser) {
        // Allow all users for testing purposes
        return true;
    }

    this.start = async function () {
        console.log("Starting LongRunningPlugin...");
    }

    this.stop = async function () {
        console.log("Stopping LongRunningPlugin...");
    }

    /**
     * Simulates a long-running operation by waiting for the specified duration
     * @param {number} duration - Duration in milliseconds to wait
     * @returns {Promise<string>} - A promise that resolves after the specified duration
     */
    this.longOperation = async function (duration) {
        console.log(`Starting long operation that will take ${duration}ms`);

        // Simulate a long-running operation
        await new Promise(resolve => setTimeout(resolve, duration));

        console.log(`Completed long operation after ${duration}ms`);
        return "Completed long operation";
    }

}

module.exports = {
    getInstance: async () => {
        return new LongRunningPlugin();
    }
};