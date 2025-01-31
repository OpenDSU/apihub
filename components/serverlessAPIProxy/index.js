const httpWrapper = require("../../http-wrapper/src/httpUtils");
const createServerlessAPIProxy = (server, serverlessApiUrl) => {
    // extract the serverless api address from the url
    const serverlessApiAddress = serverlessApiUrl.split("/").slice(0, 3).join("/");
    // extract the url prefix from the url (the part after the serverless api address starting with /)
    const urlPrefix = serverlessApiUrl.split("/").slice(3).join("/");

    function forwardRequest(data, callback) {
        let protocol = serverlessApiAddress.indexOf("https://") === 0 ? "https" : "http";
        protocol = require(protocol);

        let request = protocol.request(`${serverlessApiAddress}${urlPrefix}/executeCommand`, {method: "PUT"}, (resp) => {
            resp.body = [];

            // A chunk of data has been received.
            resp.on("data", (chunk) => {
                resp.body.push(chunk);
            });

            // The whole response has been received. Print out the result.
            resp.on("end", () => {
                callback(undefined, Buffer.concat(resp).toString());
            });
        });

        request.on("error", callback);

        request.write(data);
        request.end();
    }

    server.put(`/${urlPrefix}/executeCommand`, httpWrapper.bodyParser);

    server.put(`/${urlPrefix}/executeCommand`, function (req, res) {
        try{
            req.body = JSON.parse(req.body);
        } catch (e) {
            res.statusCode = 500;
            res.write("Unable to decode JSON request body");
            return res.end();
        }

        req.body.asUser = "admin";
        forwardRequest(req.body, (err, response) => {
            if (err) {
                res.statusCode = 500;
                logger.error(`Error while executing command ${JSON.parse(req.body).name}`, err);
                res.write(err.message);
                return res.end();
            }

            res.statusCode = response.statusCode;
            res.write(response.body);
            res.end();
        });
    });

    return server;
}

module.exports = {
    createServerlessAPIProxy
}