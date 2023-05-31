async function requestFSBrickStorageMiddleware(request, response, next) {
    const { domain: domainName } = request.params;
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

    request.fsBrickStorage = createFSBrickStorage(
        domainName,
        domainConfig.path,
        request.server.rootFolder
    );
    next();
}

module.exports = {
    requestFSBrickStorageMiddleware
};
