const logger = $$.getLogger("lightDB", "apihub");
const httpWrapper = require("../../http-wrapper/src/httpUtils");
const prefix = "lightDB";

function LightDBEnclave(server) {
    function forwardRequest(path, data, callback) {
        const endpoint = process.env.LIGHT_DB_SERVER_ADDRESS || "http://127.0.0.1:8081";
        let protocol = endpoint.indexOf("https://") === 0 ? "https" : "http";
        protocol = require(protocol);

        let request = protocol.request(`${endpoint}${path}`, {method: "PUT"}, (resp) => {
            resp.body = "";

            // A chunk of data has been received.
            resp.on("data", (chunk) => {
                resp.body += chunk;
            });

            // The whole response has been received. Print out the result.
            resp.on("end", () => {
                callback(undefined, resp);
            });
        });

        request.on("error", callback);

        request.write(data);
        request.end();
    }

    server.put(`/${prefix}/executeCommand/:dbName`, httpWrapper.bodyParser);

    server.put(`/${prefix}/executeCommand/:dbName`, function (req, res) {
        const url = `/executeCommand/${req.params.dbName}`;
        forwardRequest(url, req.body, (err, response) => {
            if (err) {
                res.statusCode = 500;
                logger.error(`Error while executing command ${JSON.parse(req.body).commandName}`, err);
                res.write(err.message);
                return res.end();
            }

            res.statusCode = response.statusCode;
            res.write(response.body);
            res.end();
        });
    });

    server.put(`/${prefix}/createDatabase/:dbName`, function (req, res) {
        const url = `/createDatabase/${req.params.dbName}`;

        forwardRequest(url, "", (err, response) => {
            if (err) {
                res.statusCode = 500;
                logger.error(`Error while creating database ${req.params.dbName}`, err);
                res.write(err.message);
                return res.end();
            }

            res.statusCode = response.statusCode;
            res.write(response.body);
            res.end();
        });
    });
}

module.exports = LightDBEnclave;