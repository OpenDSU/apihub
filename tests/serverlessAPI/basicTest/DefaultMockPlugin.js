function DefaultMockPlugin() {
    this.helloWorld = async function () {
        console.log("Hello World Core1!");
        return "Hello World Core1!"
    }

    this.hello = async function () {
        console.log("Hello Core1!");
        return "Hello Core1!"
    }

    this.getEnvironmentVariable = async function (varName) {
        return process.env[varName];
    }

    this.getPublicMethods = function () {
        return ["helloWorld", "hello", "getEnvironmentVariable"];
    }
}

function getInstance() {
    return new Promise((resolve, reject) => {
        resolve(new DefaultMockPlugin());
    });
}

/**
 * Get the plugin dependencies
 * @returns {Array<string>} - Array of plugin names this plugin depends on
 */
function getDependencies() {
    return []; // No dependencies
}

function getAllow() {
    return async function (globalUserId, email, command, ...args) {
        return true;
    }
}

module.exports = {
    getInstance,
    getAllow,
    getDependencies
};
