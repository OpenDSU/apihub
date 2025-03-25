function getInstance() {
    return {
        helloWorld: function() {
            return "Hello World Core2!";
        },
        hello: function() {
            return "Hello Core2!";
        },
        getEnv: function(...vars) {
            const result = {};
            vars.forEach(varName => {
                result[varName] = process.env[varName];
            });
            return result;
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