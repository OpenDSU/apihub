function MockCore() {
    this.allow = function (asUser) {
        return true;
    }

    this.start = function (callback) {
        console.log("Starting core...");
        callback();
    }

    this.stop = function (callback) {
        console.log("Stopping core...");
        callback();
    }

    this.helloWorld = function (callback) {
        console.log("Hello World!");
        callback(undefined, "Hello World!");
    }

    this.hello = function (callback) {
        console.log("Hello!");
        callback(undefined, "Hello!");
    }
}

module.exports = {
    getCoreInstance: async () => {
        return new MockCore()
    }
};
