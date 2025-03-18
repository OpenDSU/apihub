function DefaultMockPlugin() {
    this.allow = function (asUser) {
        return true;
    }

    this.start = async function () {
        console.log("Starting core1...");
    }

    this.stop = async function () {
        console.log("Stopping core1...");
    }

    this.helloWorld = async function () {
        console.log("Hello World Core1!");
        return "Hello World Core1!"
    }

    this.hello = async function () {
        console.log("Hello Core1!");
        return "Hello Core1!"
    }
}

function getInstance() {
    return {
        helloWorld: function () {
            return "Hello World Core1!";
        },
        hello: function () {
            return "Hello Core1!";
        }
    }
}

/**
 * Get the plugin dependencies
 * @returns {Array<string>} - Array of plugin names this plugin depends on
 */
function getDependencies() {
    return []; // No dependencies
}

function getAllow() {
    return function () {
        return true;
    }
}

module.exports = {
    getInstance,
    getAllow,
    getDependencies
};
