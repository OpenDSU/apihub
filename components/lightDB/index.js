const logger = $$.getLogger("lightDB", "apihub");
function LightDB(server) {
    const lokiEnclaveFacadeModule = require("loki-enclave-facade");
    const createLightDBServerInstance = lokiEnclaveFacadeModule.createLightDBServerInstance;
    createLightDBServerInstance(8081, server.rootFolder, "localhost", (err) => {
        if (err) {
            return logger.error(err);
        }

        logger.info(`LightDB server started on port 8081`);
    });
}

module.exports = LightDB;