function MockCore(){
    this.allow = function(asUser){
        return true;
    }

    this.start = function(callback){
        console.log("Starting core...");
        callback();
    }

    this.stop = function(callback){
        console.log("Stopping core...");
        callback();
    }

    this.helloWorld = function(callback){
        console.log("Hello world!");
        callback();
    }

    this.hello = function(callback){
        console.log("Hello!");
        callback();
    }
}

module.exports = MockCore;