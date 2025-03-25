function ObservableLambdaPlugin() {
    const path = require('path');
    const observableResponsePath = path.join(__dirname, '../../../serverlessAPI/lib/ObservableResponse.js');
    const ObservableResponse = require(observableResponsePath);

    this.processDataObservableTest = async function (data) {
        const observableResponse = new ObservableResponse();
        let count = 0;
        
        await observableResponse.progress({
            percent: count * 10,
            status: 'Starting process',
            details: 'Initializing operation'
        });

        let interval = setInterval(async () => {
            count++;
            if (count >= 10) {
                clearInterval(interval);
                await observableResponse.end();
                return;
            }
            
            await observableResponse.progress({
                percent: count * 10,
                status: 'Processing',
                details: `Completed ${count} out of 10 steps`,
                currentStep: count
            });
        }, 1000);

        return observableResponse;
    };

    this.quickObservableTest = function () {
        console.log("ObservablePlugin: quickObservableTest called");
        return "Quick observable test completed";
    };
}

function getDependencies() {
    return [];
}

function getInstance() {
    return new ObservableLambdaPlugin();
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