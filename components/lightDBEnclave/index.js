const logger = $$.getLogger("lightDB", "apihub");
const httpWrapper = require("../../libs/http-wrapper/src/httpUtils");

function LightDBEnclave(server) {
    const httpAPI = require("opendsu").loadAPI("http");
    server.put("/executeLightDBEnclaveCommand", httpWrapper.bodyParser);

    server.put("/executeLightDBEnclaveCommand", (req, res) => {
        const url = `${process.env.LIGHT_DB_SERVER_ADDRESS}/executeCommand`;
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

module.exports = LightDBEnclave;