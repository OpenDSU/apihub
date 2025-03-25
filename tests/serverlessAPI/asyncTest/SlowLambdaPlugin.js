function SlowLambdaPlugin() {
    const SlowResponse = require('../../../serverlessAPI/lib/SlowResponse');
    this.processDataAsyncTest = async function (data) {
        const slowResponse = new SlowResponse();
        let count = 0;
        await slowResponse.progress(count * 10);
        let interval = setInterval(async () => {
            count++;
            if (count >= 10) {
                clearInterval(interval);
                await slowResponse.end("This is a slow operation response");
                return;
            }
            await slowResponse.progress(count * 10);
        }, 2000);
        return slowResponse;
    };

    this.fastOperationTest = function () {
        console.log("AsyncPlugin: fastOperationTest called");
        return "This is a fast operation response";
    };
}

function getDependencies() {
    return [];
}

function getInstance() {
    return new SlowLambdaPlugin();
}

function getAllow() {
    return function (forWhom, name) {
        return true;
    };
}

module.exports = {
    getDependencies,
    getInstance,
    getAllow
};