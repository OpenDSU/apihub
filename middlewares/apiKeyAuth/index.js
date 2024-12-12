function APIKeyAuth(server) {
    const SecretsService = require("../../components/secrets/SecretsService");
    let secretServiceInstance;
    const utils = require("../../http-wrapper/utils/cookie-utils.js")

    const authorizationHeaderContainsAValidAPIKey = async (req) => {
        const apiKey = req.headers["x-api-key"];
        if (!apiKey) {
            return false;
        }

        return await secretServiceInstance.validateAPIKey(apiKey);
    }

    server.use(async (req, res, next) => {
        if (!secretServiceInstance) {
            secretServiceInstance = await SecretsService.getSecretsServiceInstanceAsync(server.rootFolder);
        }

        if (req.skipSSO) {
            delete req.skipSSO;
        }

        if (req.skipClientCredentialsOauth) {
            delete req.skipClientCredentialsOauth;
        }

        if (await authorizationHeaderContainsAValidAPIKey(req)) {
            req.skipSSO = true;
            req.skipClientCredentialsOauth = true;
            return next();
        }

        const {apiKey} = utils.parseCookies(req.headers.cookie);

        if (!apiKey) {
            return next();
        }

        if (await secretServiceInstance.validateAPIKey(apiKey)) {
            req.skipSSO = true;
            req.skipClientCredentialsOauth = true;
            return next();
        }

        res.statusCode = 403;
        res.end("Forbidden Api Key Auth");
    });

}

module.exports = APIKeyAuth;