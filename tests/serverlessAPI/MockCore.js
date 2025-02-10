function MockCore() {
    this.allow = function (asUser) {
        return true;
    }

    this.start = async function () {
        console.log("Starting core...");
    }

    this.stop = async function () {
        console.log("Stopping core...");
    }

    this.helloWorld = async function () {
        console.log("Hello World!");
        return "Hello World!"
    }

    this.hello = async function () {
        console.log("Hello!");
        return "Hello!"
    }
}

module.exports = {
    getCoreInstance: async () => {
        return new MockCore()
    }
};
