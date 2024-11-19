async function requestFSBrickStorageMiddleware(request, response, next) {
    const {domain: domainName} = request.params;
    const logger = $$.getLogger("requestFSBrickStorageMiddleware", "apihub/bricking");

    const brickingConfig = await require("./utils").getBricksDomainConfig(domainName);
    const domainConfig = require("../../http-wrapper/config").getDomainConfig(domainName);
    if (!brickingConfig || !brickingConfig.path) {
        const message = `[Bricking] Domain '${domainName}' not found!`;
        logger.error(message);
        return response.send(404, message);
    }

    const createFSBrickStorage = (...props) => {
        return require("./replication/FSBrickStorage").create(...props);
    };

    const FsBrickPathsManager = require("./replication/FSBrickPathsManager");
    request.fsBrickStorage = createFSBrickStorage(
        domainName,
        brickingConfig.path,
        request.server.rootFolder,
        new FsBrickPathsManager(2),
        domainConfig
    );

    request.oldFsBrickStorage = createFSBrickStorage(
        domainName,
        brickingConfig.path,
        request.server.rootFolder,
        new FsBrickPathsManager(5),
        domainConfig
    );

    next();
}

module.exports = {
    requestFSBrickStorageMiddleware
};
