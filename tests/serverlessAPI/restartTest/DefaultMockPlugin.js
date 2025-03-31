function getInstance() {
    return {
        helloWorld: function() {
            return "Hello World Core1!";
        },
        hello: function() {
            return "Hello Core1!";
        },
        getEnvironmentVariable: async function(varName) {
            return process.env[varName];
        },
        shutdown: async function() {
            console.log("DefaultMockPlugin shutting down");
        }
    };
}

function getAllow() {
    return function(forWhom) {
        return true;
    };
}

function getDependencies() {
    return [];
}

module.exports = {
    getInstance,
    getAllow,
    getDependencies
}; 