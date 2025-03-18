/**
 * BasePlugin - A simple plugin with no dependencies
 * 
 * This plugin provides basic functionality that other plugins can build upon.
 * It has no dependencies on other plugins.
 */

function getInstance() {
    return {
        hello: function() {
            return "Hello from BasePlugin!";
        }
    };
}

/**
 * Get the plugin dependencies
 * @returns {Array<string>} - Array of plugin names this plugin depends on
 */
function getDependencies() {
    return []; // No dependencies
}

/**
 * Define the authorization function for this plugin
 * @returns {Function} - Function that checks if a user is allowed to use this plugin
 */
function getAllow() {
    return function(forWhom, name) {
        // Allow everyone to use this plugin for testing purposes
        return true;
    };
}

module.exports = {
    getInstance,
    getAllow,
    getDependencies
}; 