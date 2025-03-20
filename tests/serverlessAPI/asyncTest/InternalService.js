const DelayedResponse = require('../../../serverlessAPI/lib/DelayedResponse');

/**
 * InternalService - Mock implementation of an internal service
 * that performs long-running operations
 */
class InternalService {
    constructor() {
        this.operations = new Map();
    }

    /**
     * Process a long-running operation
     * @param {string} operationType - Type of operation to perform
     * @param {Object} data - Input data for the operation
     * @returns {DelayedResponse} A DelayedResponse instance for tracking the operation
     */
    processOperation(operationType, data) {
        console.log(`InternalService: Starting ${operationType} operation`, data);

        // Create a DelayedResponse instance to track this operation
        const delayedResponse = new DelayedResponse((progressUpdate) => {
            // This callback will be called whenever we update progress
            console.log(`InternalService: Progress update for ${operationType}:`, progressUpdate);
        });

        // Store the operation details
        const operationId = delayedResponse.getCallId();
        this.operations.set(operationId, {
            type: operationType,
            data,
            status: 'running',
            startTime: Date.now(),
            delayedResponse
        });

        // Simulate progress updates
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += 10;
            console.log(`InternalService: Operation ${operationId} progress: ${progress}%`);

            if (progress < 100) {
                delayedResponse.updateProgress(progress, `Processing ${operationType}: ${progress}%`);
            } else {
                clearInterval(progressInterval);

                // Generate a result based on the operation type
                let result;
                switch (operationType) {
                    case 'processData':
                        result = {
                            processed: true,
                            items: data.items || 0,
                            summary: `Processed ${data.items || 0} items successfully`
                        };
                        break;
                    case 'generateReport':
                        result = {
                            success: true,
                            reportId: `report_${Date.now()}`,
                            generatedAt: new Date().toISOString(),
                            parameters: data
                        };
                        break;
                    default:
                        result = {
                            completed: true,
                            operationType,
                            timestamp: new Date().toISOString()
                        };
                }

                this.operations.set(operationId, {
                    ...this.operations.get(operationId),
                    status: 'completed',
                    endTime: Date.now(),
                    result
                });

                // Complete the DelayedResponse with the result
                delayedResponse.complete(result);
            }
        }, 1000); // Update progress every second

        // Return the DelayedResponse instance immediately
        return delayedResponse;
    }

    /**
     * Get the status of an operation
     * @param {string} operationId - ID of the operation
     * @returns {Object|null} Operation status or null if not found
     */
    getOperationStatus(operationId) {
        return this.operations.get(operationId) || null;
    }
}

// Singleton instance
let instance = null;

/**
 * Get the InternalService instance
 */
function getInstance() {
    if (!instance) {
        instance = new InternalService();
    }
    return instance;
}

module.exports = {
    getInstance
};