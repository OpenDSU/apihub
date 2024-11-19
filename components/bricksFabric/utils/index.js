const {clone} = require("../../../http-wrapper/utils");

const getBricksFabricStrategy = () => {
    const config = require("../../../http-wrapper/config");
    const domainConfiguration = config.getDomainConfig("default");
    if (!domainConfiguration) {
        return;
    }

    let domainConfig = domainConfiguration.bricksFabric;

    if (!domainConfig) {
        // try to get the bricks strategy based on the bricksFabric component config
        const bricksFabricConfig = config.getConfig("componentsConfig", "bricksFabric");
        if (bricksFabricConfig) {
            const {bricksFabricStrategy, bricksFabricStrategyOption} = bricksFabricConfig;
            domainConfig = {
                name: bricksFabricStrategy,
                option: bricksFabricStrategyOption,
            };
        } else {
            return;
        }
    }
    domainConfig = clone(domainConfig);
    return domainConfig;
};

const getRootFolder = () => {
    // temporary location where we store the last hashlink
    const config = require("../../../http-wrapper/config");
    return config.getConfig("componentsConfig", "bricksFabric").path;
};

module.exports.getBricksFabricStrategy = getBricksFabricStrategy;
module.exports.getRootFolder = getRootFolder;
