function APIKeyAuth(server) {
    const SecretsService = require("../../components/secrets/SecretsService");
    let secretServiceInstance;
    const utils = require("../../utils/cookie-utils.js")

    const authorizationHeaderContainsAValidAPIKey = (req) => {
        const header = req.headers["Authorization"];
        if (!header) {
            return false;
        }

        const apiKey = header.split(" ")[1];
        return secretServiceInstance.validateAPIKey(apiKey);
    }

    server.use(async (req, res, next) => {
        if (!secretServiceInstance) {
            secretServiceInstance = await SecretsService.getSecretsServiceInstanceAsync(server.rootFolder);
        }

        if (req.skipSSO) {
            delete req.skipSSO;
        }

        if (authorizationHeaderContainsAValidAPIKey(req)) {
            req.skipSSO = true;
            return next();
        }

        //api
        const {apiKey} = utils.parseCookies(req.headers.cookie);

        if(!apiKey){
            return next();
        }

        if(secretServiceInstance.validateAPIKey(apiKey)){
            req.skipSSO = true;
            return next();
        }
    });

}

module.exports = APIKeyAuth;