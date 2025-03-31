const CMBSlowResponse = require('../../../serverlessAPI/lib/CMBSlowResponse');

function ExternalWebhookPlugin() {
    this.slowOperation = function () {
        const response = new CMBSlowResponse();

        // put request to external webhook after 5 seconds
        setTimeout(async () => {
            const url = `${process.env.EXTERNAL_WEBHOOK_URL}/result`;
            const res = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    id: response.externalWebhookId,
                    data: 'test'
                })
            });
            if (!res.ok) {
                throw new Error(`Failed to send data to external webhook: ${res.statusText}`);
            }
        }, 5000);

        // Simulate progress updates
        let percent = 0;
        const progressInterval = setInterval(async () => {
            if (percent < 100) {
                percent += 20;
                await response.progress({percent});
            } else {
                clearInterval(progressInterval);
            }
        }, 500);

        response.onExternalWebhook(async (data) => {
            await response.end(data);
        });

        return response;
    };
}

module.exports.getInstance = function () {
    return new ExternalWebhookPlugin();
};

module.exports.getDependencies = function () {
    return [];
};

module.exports.getAllow = function () {
    return function (forWhom) {
        return true; // Allow all users for testing
    };
}; 