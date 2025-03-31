function getInstance() {
    return {
        helloWorld: function() {
            return "Hello World Core2!";
        },
        hello: function() {
            return "Hello Core2!";
        },
        getEnvironmentVariable: async function(varName) {
            return process.env[varName];
        },
        shutdown: async function() {
            console.log("RuntimeMockPlugin shutting down");
        }
    };
}

function getAllow() {
    return function(forWhom) {
        return true;
    };
}

function getDependencies() {
    return ["DefaultMockPlugin"];
}

module.exports = {
    getInstance,
    getAllow,
    getDependencies
}; 