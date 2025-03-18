/**
 * FeaturesPlugin - A plugin that provides additional features
 * 
 * This plugin depends on BasePlugin and extends its functionality.
 */

function getInstance() {
    // Get an instance of BasePlugin to use its functionality
    const basePlugin = $$.loadPlugin('BasePlugin');
    const utils = require('../deps/utils');
    
    return {
        hello: function() {
            const str =`${basePlugin.hello()} And hello from FeaturesPlugin!`;
            utils.print(str);
            return str;
        }
    };
}

function getDependencies() {
    return ['BasePlugin']; // Depends on BasePlugin
}

function getAllow() {
    return function(forWhom, name) {
        return true;
    };
}

module.exports = {
    getInstance,
    getAllow,
    getDependencies
}; 