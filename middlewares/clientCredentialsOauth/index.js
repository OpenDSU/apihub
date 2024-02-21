function ClientCredentialsOauth(server) {
    const config = require("../../config");
    const jwksEndpoint = config.getConfig("oauthJWKSEndpoint");
    const util = require("../oauth/lib/util");

    server.use(async (req, res, next) => {
        if (req.skipClientCredentialsOauth) {
            return next();
        }

        if (!req.headers.authorization) {
            res.statusCode = 401;
            res.end("Missing Authorization header");
            return;
        }

        const token = req.headers.authorization.split(" ")[1];
        util.validateAccessToken(jwksEndpoint, token, (err) => {
            if (err) {
                res.statusCode = 401;
                return res.end("Invalid token");
            }

            next();
        })
    });
}


module.exports = ClientCredentialsOauth;