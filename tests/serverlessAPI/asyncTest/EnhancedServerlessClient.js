const NotificationManager = require('./NotificationManager');
const EventEmitter = require('events');

/**
 * EnhancedServerlessClient - Client that transparently handles both synchronous
 * and asynchronous operations with a consistent interface
 */
function createEnhancedServerlessClient(userId, endpoint, pluginName, webhookUrl) {
    if (!endpoint) {
        throw new Error('Endpoint URL is required');
    }

    // Create event emitter for progress events
    const eventEmitter = new EventEmitter();

    // Create notification manager for polling webhook
    const notificationManager = new NotificationManager(webhookUrl);

    // Store the base endpoint and create the command endpoint
    const baseEndpoint = endpoint;
    const commandEndpoint = `${endpoint}/executeCommand`;

    // Map to track pending async operations
    const pendingOperations = new Map();

    // Define the private execute command function
    const __executeCommand = async (commandName, args) => {
        args = args || [];

        const command = {
            forWhom: userId,
            name: commandName,
            pluginName,
            args: args
        };

        try {
            const response = await fetch(commandEndpoint, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(command)
            });

            // Parse the response
            const res = await response.json();

            // Handle errors
            if (!res || res.err) {
                const errorMessage = res.err ? res.err : "Unknown error";
                throw new Error(`Command ${commandName} execution failed: ${JSON.stringify(errorMessage)}`);
            }

            const result = res.result;

            // If the result is a string that looks like a call ID, it's an async operation
            if (typeof result === 'string' && result.startsWith('call_')) {
                console.log(`Received call ID ${result}, waiting for result...`);

                // Register the operation in the pending map
                pendingOperations.set(result, {
                    commandName,
                    args,
                    startTime: Date.now()
                });

                // Setup progress handler
                const progressHandler = (progressData) => {
                    // Emit a progress event that the user can listen to if they want
                    eventEmitter.emit('progress', {
                        callId: result,
                        commandName,
                        data: progressData
                    });
                };

                // Wait for the result using the notification manager
                const finalResult = await notificationManager.waitForResult(result, {
                    onProgress: progressHandler
                });

                // Remove from pending operations
                pendingOperations.delete(result);

                // Emit completion event
                eventEmitter.emit('complete', {
                    callId: result,
                    commandName,
                    result: finalResult
                });

                return finalResult;
            }

            // If it's not a call ID, return the direct result
            return result;
        } catch (error) {
            throw error;
        }
    };

    // Create a special registerPlugin method
    const registerPlugin = async (pluginName, pluginPath) => {
        try {
            const response = await fetch(`${baseEndpoint}/registerPlugin`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    pluginName,
                    pluginPath
                })
            });

            if (response.status >= 400) {
                const res = await response.json();
                if (!res || res.err) {
                    const errorMessage = res.err ? res.err : "Unknown error";
                    throw new Error(`Plugin registration failed: ${JSON.stringify(errorMessage)}`);
                }
            }
        } catch (error) {
            throw error;
        }
    };

    // Method to cancel polling for a specific call ID
    const cancelOperation = (callId) => {
        return notificationManager.cancelPolling(callId);
    };

    // Method to cleanup resources when done
    const cleanup = () => {
        eventEmitter.removeAllListeners();
        return notificationManager.cancelAll();
    };

    // Method to get all pending operations
    const getPendingOperations = () => {
        const operations = [];
        for (const [callId, data] of pendingOperations.entries()) {
            operations.push({
                callId,
                commandName: data.commandName,
                startTime: data.startTime,
                elapsedMs: Date.now() - data.startTime
            });
        }
        return operations;
    };

    // Method to subscribe to progress events if the user wants to
    const onProgress = (callback) => {
        eventEmitter.on('progress', callback);
        return () => eventEmitter.off('progress', callback); // Return function to unsubscribe
    };

    // Method to subscribe to completion events
    const onComplete = (callback) => {
        eventEmitter.on('complete', callback);
        return () => eventEmitter.off('complete', callback); // Return function to unsubscribe
    };

    // Create a base object with special methods
    const baseClient = {
        registerPlugin,
        cancelOperation,
        cleanup,
        getPendingOperations,
        onProgress,
        onComplete
    };

    // Create a Proxy to handle method calls
    return new Proxy(baseClient, {
        get: (target, prop) => {
            // If the property exists on the target (special methods), return it
            if (prop in target) {
                return target[prop];
            }

            // For all other methods, return a function that handles both sync and async
            return async (...args) => {
                return await __executeCommand(prop, args);
            };
        }
    });
}

module.exports = {
    createEnhancedServerlessClient
};