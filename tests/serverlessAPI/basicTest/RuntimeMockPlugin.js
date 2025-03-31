function RuntimeMockPlugin() {
    this.helloWorld = async function () {
        console.log("Hello World Core2!");
        return "Hello World Core2!"
    }

    this.hello = async function () {
        console.log("Hello Core2!");
        return "Hello Core2!"
    }
}

function getInstance() {
    return {
        helloWorld: function () {
            return "Hello World Core2!";
        },
        hello: function () {
            return "Hello Core2!";
        }
    }
}

/**
 * Get the plugin dependencies
 * @returns {Array<string>} - Array of plugin names this plugin depends on
 */
function getDependencies() {
    return ["DefaultMockPlugin"];
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
