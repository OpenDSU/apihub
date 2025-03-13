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

module.exports = {
    getInstance: async () => {
        return new DefaultMockPlugin()
    },
    getAllow: function() {
        return async function (globalUserId, email, command, ...args) {
            return true;
        }
    }
};
