function VersionlessDSU(server) {
    const { init, handleGetVersionlessDSURequest, handlePutVersionlessDSURequest } = require("./controller");
    const { bodyReaderMiddleware } = require("../../utils/middlewares");

    init(server);

    server.get("/versionlessdsu/*", handleGetVersionlessDSURequest);

    server.put("/versionlessdsu/*", bodyReaderMiddleware);
    server.put("/versionlessdsu/*", handlePutVersionlessDSURequest);

}

module.exports = VersionlessDSU;
