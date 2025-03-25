function SlowLambdaPlugin() {
    const path  = require('path');
    const slowResponsePath = path.join(__dirname, '../../../serverlessAPI/lib/SlowResponse.js');
    console.log('SlowLambdaPlugin: __dirname', __dirname);
    console.log('slowResponsePath', slowResponsePath);
    const SlowResponse = require(slowResponsePath);
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
        }, 1000);
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