function SlowInitPlugin() {
    this.helloWorld = async function () {
        console.log("Hello World from SlowInitPlugin!");
        return "Hello World from SlowInitPlugin!"
    }
}

async function getInstance() {
    await new Promise(resolve => setTimeout(resolve, 3000));
    return new SlowInitPlugin();
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