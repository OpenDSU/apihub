const logger = $$.getLogger("lightDB", "apihub");
const httpWrapper = require("../../libs/http-wrapper/src/httpUtils");
function LightDB(server) {
    const lokiEnclaveFacadeModule = require("loki-enclave-facade");
    const createLightDBServerInstance = lokiEnclaveFacadeModule.createLightDBServerInstance;
    const HOST = "localhost";
    const PORT = 8081;

    createLightDBServerInstance(PORT, server.rootFolder, HOST, (err) => {
        if (err) {
            return logger.error(err);
        }

        logger.info(`LightDB server started on port ${PORT}`);
    });
    const httpAPI = require("opendsu").loadAPI("http");

    server.put("/executeLightDBCommand", httpWrapper.bodyParser);

    server.put("/executeLightDBCommand", (req, res) => {
        const url = `http://${HOST}:${PORT}/executeCommand`;
        httpAPI.doPut(url, req.body, (err, response) => {
            if (err) {
                res.statusCode = 500;
                logger.error(`Error while executing command ${JSON.parse(req.body).commandName}`, err);
                res.write(err.message);
                return res.end();
            }

            res.statusCode = 200;
            res.write(response);
            res.end();
        });
    })

}

module.exports = LightDB;