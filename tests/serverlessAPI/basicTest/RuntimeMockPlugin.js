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

module.exports = {
    getInstance: async () => {
        return new RuntimeMockPlugin()
    }
};
