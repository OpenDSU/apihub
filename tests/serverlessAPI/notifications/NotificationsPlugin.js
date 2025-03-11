function NotificationsPlugin() {
    const subscriptions = new Map();

    // Generate a unique subscription ID
    function generateSubscriptionId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    this.allow = function (asUser) {
        // Allow all users for testing purposes
        return true;
    }

    this.start = async function () {
        console.log("Starting NotificationsPlugin...");
    }

    this.stop = async function () {
        console.log("Stopping NotificationsPlugin...");
        // Clean up any active subscriptions
        subscriptions.clear();
    }

    this.subscribeToNotifications = async function (userId) {
        const subscriptionId = generateSubscriptionId();

        subscriptions.set(subscriptionId, {
            userId,
            notifications: [],
            createdAt: Date.now()
        });

        console.log(`User ${userId} subscribed to notifications with ID ${subscriptionId}`);
        return subscriptionId;
    }

    this.unsubscribeFromNotifications = async function (subscriptionId) {
        const result = subscriptions.delete(subscriptionId);
        console.log(`Unsubscribed from notifications with ID ${subscriptionId}, success: ${result}`);
        return result;
    }

    this.getNotifications = async function (subscriptionId) {
        const subscription = subscriptions.get(subscriptionId);

        if (!subscription) {
            throw new Error(`Subscription ${subscriptionId} not found`);
        }

        // Return notifications and clear the queue
        const notifications = [...subscription.notifications];
        subscription.notifications = [];

        return notifications;
    }

    this.triggerNotifications = async function (count, interval) {
        console.log(`Triggering ${count} notifications at ${interval}ms intervals`);

        // Create a promise that resolves after all notifications are sent
        return new Promise((resolve) => {
            let sent = 0;

            // Function to send a single notification
            const sendNotification = () => {
                sent++;
                const notificationId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
                const notification = {
                    id: notificationId,
                    timestamp: Date.now(),
                    message: `Notification ${sent} of ${count}`,
                    data: { value: Math.random() * 100 }
                };

                console.log(`Sending notification: ${notification.message}`);

                // Add the notification to all active subscriptions
                for (let [subscriptionId, subscription] of subscriptions.entries()) {
                    subscription.notifications.push(notification);
                    console.log(`Added notification to subscription ${subscriptionId}`);
                }

                // Schedule the next notification or resolve the promise if done
                if (sent < count) {
                    setTimeout(sendNotification, interval);
                } else {
                    resolve(true);
                }
            };

            // Start sending notifications
            sendNotification();
        });
    }

    this.registerEventListener = async function (eventType, userId) {
        // This would normally set up an SSE connection, but for testing
        // we're just returning a subscription ID
        const registrationId = generateSubscriptionId();

        subscriptions.set(registrationId, {
            userId,
            eventType,
            notifications: [],
            createdAt: Date.now()
        });

        console.log(`User ${userId} registered for ${eventType} events with ID ${registrationId}`);
        return registrationId;
    }

    this.emitEvent = async function (eventType, eventData) {
        console.log(`Emitting ${eventType} event: ${JSON.stringify(eventData)}`);

        let notifiedCount = 0;

        // Create an event object
        const event = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            type: eventType,
            timestamp: Date.now(),
            data: eventData
        };

        // Add the event to all matching subscriptions
        for (let [subscriptionId, subscription] of subscriptions.entries()) {
            if (subscription.eventType === eventType) {
                subscription.notifications.push(event);
                notifiedCount++;
                console.log(`Added ${eventType} event to subscription ${subscriptionId}`);
            }
        }

        return notifiedCount;
    }
}

module.exports = {
    getInstance: async () => {
        return new NotificationsPlugin();
    }
};