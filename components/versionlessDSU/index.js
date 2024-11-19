function VersionlessDSU(server) {
    const logger = $$.getLogger("VersionlessDSU");
    logger.info("Initializing VersionlessDSU");
    const {init, handleGetVersionlessDSURequest, handlePutVersionlessDSURequest} = require("./controller");
    const {bodyReaderMiddleware} = require("../../http-wrapper/utils/middlewares");

    init(server);

    server.get("/versionlessdsu/*", handleGetVersionlessDSURequest);

    server.put("/versionlessdsu/*", bodyReaderMiddleware);
    server.put("/versionlessdsu/*", handlePutVersionlessDSURequest);

}

module.exports = VersionlessDSU;
