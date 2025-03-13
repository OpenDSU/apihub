/**
 * DelayedResponse - handles asynchronous responses for long-running operations
 * Tracks the status of a request and allows for status updates via progressCallback
 */
class DelayedResponse {
    constructor(progressCallback) {
        this.id = this._generateId();
        this.status = 'pending';
        this.result = null;
        this.error = null;
        this.createdAt = Date.now();
        this.completedAt = null;
        this.progressCallback = progressCallback;
    }

    /**
     * Generate a unique call ID
     */
    _generateId() {
        return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Update the progress of the operation
     * @param {number} percent - Progress percentage (0-100)
     * @param {string} message - Optional status message
     */
    updateProgress(percent, message) {
        if (this.status === 'completed' || this.status === 'failed') {
            return false;
        }

        this.progressCallback({
            id: this.id,
            status: 'in_progress',
            progress: percent,
            message: message || `Processing: ${percent}%`
        });

        return true;
    }

    /**
     * Mark the operation as completed
     * @param {any} result - The result of the operation
     */
    complete(result) {
        if (this.status === 'completed' || this.status === 'failed') {
            return false;
        }

        this.status = 'completed';
        this.result = result;
        this.completedAt = Date.now();

        this.progressCallback({
            id: this.id,
            status: 'completed',
            result: this.result
        });

        return true;
    }

    /**
     * Mark the operation as failed
     * @param {Error} error - The error that occurred
     */
    fail(error) {
        if (this.status === 'completed' || this.status === 'failed') {
            return false;
        }

        this.status = 'failed';
        this.error = error;
        this.completedAt = Date.now();

        this.progressCallback({
            id: this.id,
            status: 'failed',
            error: this.error.message || String(this.error)
        });

        return true;
    }

    /**
     * Get the call ID for the client to track this operation
     */
    getCallId() {
        return this.id;
    }
}

module.exports = DelayedResponse;