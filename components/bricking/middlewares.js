async function requestFSBrickStorageMiddleware(request, response, next) {
    const {domain: domainName} = request.params;
    const logger = $$.getLogger("requestFSBrickStorageMiddleware", "apihub/bricking");

    const domainConfig = await require("./utils").getBricksDomainConfig(domainName);
    if (!domainConfig || !domainConfig.path) {
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
        domainConfig.path,
        request.server.rootFolder,
        new FsBrickPathsManager(2)
    );

    request.oldFsBrickStorage = createFSBrickStorage(
        domainName,
        domainConfig.path,
        request.server.rootFolder,
        new FsBrickPathsManager(5)
    );

    next();
}

module.exports = {
    requestFSBrickStorageMiddleware
};
