const httpWrapper = require("../../http-wrapper/src/httpUtils");
const createServerlessAPIProxy = async (server) => {
    const urlPrefix = '/proxy'
    const registeredServerlessProcessesUrls = {};

    function forwardRequest(serverlessApiAddress, data, callback) {
        let protocol = serverlessApiAddress.indexOf("https://") === 0 ? "https" : "http";
        protocol = require(protocol);

        let request = protocol.request(serverlessApiAddress, {
            method: "PUT",
            headers: {
                'Content-Type': 'application/json'
            }
        }, (resp) => {
            resp.body = [];

            // A chunk of data has been received.
            resp.on("data", (chunk) => {
                resp.body.push(chunk);
            });

            // The whole response has been received. Print out the result.
            resp.on("end", () => {
                let body;
                try {
                    body = JSON.parse(Buffer.concat(resp.body).toString());
                } catch (e) {
                    return callback(e);
                }
                callback(undefined, body);
            });
        });

        request.on("error", callback);

        request.write(data);
        request.end();
    }

    server.put(`${urlPrefix}/executeCommand/:serverlessId`, httpWrapper.bodyParser);

    server.put(`${urlPrefix}/executeCommand/:serverlessId`, function (req, res) {
        const serverlessId = req.params.serverlessId;
        if (!registeredServerlessProcessesUrls[serverlessId]) {
            res.statusCode = 404;
            res.write("Serverless process not found");
            return res.end();
        }

        const serverlessApiUrl = registeredServerlessProcessesUrls[serverlessId];
        forwardRequest(`${serverlessApiUrl}/executeCommand`, req.body, (err, response) => {
            if (err) {
                res.statusCode = 500;
                console.error(`Error while executing command ${JSON.parse(req.body).name}`, err);
                res.write(err.message);
                return res.end();
            }

            res.statusCode = response.statusCode;
            res.write(JSON.stringify(response));
            res.end();
        });
    });

    // Add proxy endpoint for restarting plugins
    server.put(`${urlPrefix}/restart/:serverlessId`, function (req, res) {
        const serverlessId = req.params.serverlessId;
        if (!registeredServerlessProcessesUrls[serverlessId]) {
            res.statusCode = 404;
            res.write("Serverless process not found");
            return res.end();
        }

        const serverlessApiUrl = registeredServerlessProcessesUrls[serverlessId];
        forwardRequest(`${serverlessApiUrl}/restart`, "{}", (err, response) => {
            if (err) {
                res.statusCode = 500;
                console.error("Error while restarting plugins", err);
                res.write(err.message);
                return res.end();
            }

            res.statusCode = response.statusCode;
            res.write(JSON.stringify(response));
            res.end();
        });
    });

    server.registerServerlessProcessUrl = (serverlessId, serverlessApiUrl) => {
        registeredServerlessProcessesUrls[serverlessId] = serverlessApiUrl;
    }

    return server;
}

module.exports = createServerlessAPIProxy;