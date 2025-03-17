function RuntimeMockPlugin() {
    this.allow = function (asUser) {
        return true;
    }

    this.start = async function () {
        console.log("Starting core2 ...");
    }

    this.stop = async function () {
        console.log("Stopping core2 ...");
    }

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
 * Get the name of the plugin
 * @returns {string} - The name of the plugin
 */
function getName() {
    return "RuntimeMockPlugin";
}

/**
 * Get the plugin dependencies
 * @returns {Array<string>} - Array of plugin names this plugin depends on
 */
function getDependencies() {
    return ["DefaultMockPlugin"]; // Depends on DefaultMockPlugin
}

function getAllow() {
    return function () {
        return true;
    }
}

module.exports = {
    getInstance,
    getAllow,
    getName,
    getDependencies
};
