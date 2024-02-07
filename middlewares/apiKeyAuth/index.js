function APIKeyAuth(server) {
    const SecretsService = require("../../components/secrets/SecretsService");
    let secretServiceInstance;
    const utils = require("../../utils/cookie-utils.js")

    const authorizationHeaderContainsAValidAPIKey = async (req) => {
        const apiKey = req.headers["Authorization"];
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

        if (await authorizationHeaderContainsAValidAPIKey(req)) {
            req.skipSSO = true;
            return next();
        }

        const {apiKey} = utils.parseCookies(req.headers.cookie);

        if(!apiKey){
            return next();
        }

        if(await secretServiceInstance.validateAPIKey(apiKey)){
            req.skipSSO = true;
            return next();
        }

        res.statusCode = 403;
        res.end("Forbidden");
    });

}

module.exports = APIKeyAuth;