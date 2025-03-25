function getInstance() {
    return {
        helloWorld: function() {
            return "Hello World Core1!";
        },
        hello: function() {
            return "Hello Core1!";
        },
        getEnv: function(...vars) {
            const result = {};
            vars.forEach(varName => {
                result[varName] = process.env[varName];
            });
            return result;
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