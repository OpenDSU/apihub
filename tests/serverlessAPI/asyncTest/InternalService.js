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
     * @param {Function} callback - Callback function to invoke when operation completes
     */
    processOperation(operationType, data, callback) {
        console.log(`InternalService: Starting ${operationType} operation`, data);

        // Simulate a long-running operation
        const operationId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        this.operations.set(operationId, {
            type: operationType,
            data,
            status: 'running',
            startTime: Date.now()
        });

        // Simulate progress updates
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += 10;
            console.log(`InternalService: Operation ${operationId} progress: ${progress}%`);

            if (progress < 100) {
                callback({
                    status: 'in_progress',
                    progress,
                    operationId
                });
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

                // Call the callback with the final result
                callback({
                    status: 'completed',
                    operationId,
                    result
                });
            }
        }, 1000); // Update progress every second

        // Return the operation ID immediately
        return operationId;
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