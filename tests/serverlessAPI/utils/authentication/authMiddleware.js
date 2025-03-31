function AuthMiddleware(server) {
    const AuthenticationPlugin = require("./AuthenticationPlugin");
    const requestBodyJSONMiddleware = require("../../../../http-wrapper/utils/middlewares/index").requestBodyJSONMiddleware;
    const openDSU = require("opendsu");
    const { createServerlessAPIClient } = openDSU.loadAPI("serverless");
    const system = openDSU.loadApi("system");
    const baseURL = system.getBaseURL();
    let globalClient;

    const setGlobalClient = async (req, res, next) => {
        if (!globalClient) {
            globalClient = await createServerlessAPIClient("*", baseURL, process.env.SERVERLESS_ID, "AuthenticationPlugin");
        }
        next();
    }
    
    server.use('*', setGlobalClient);
    server.put('/proxy/executeCommand/:serverlessId', requestBodyJSONMiddleware);
    server.put('/proxy/executeCommand/:serverlessId', async (req, res, next) => {
        const { email, command, ...args } = req.body;
        await setGlobalClient(req.params.serverlessId);
        const canExecute = await globalClient.checkSessionId(req.headers['x-session-id']);
        if (!canExecute) {
            return res.status(401).send('Unauthorized');
        }

        next();
    });


    server.get('/authenticate/checkUserExists/:email', async (req, res, next) => {
        const { email } = req.params;
        const userExists = await globalClient.checkUserExists(email);
        if (!userExists) {
            return res.status(401).send('Unauthorized');
        }
        next();
    });

    server.put('/authenticate/createUser/:email', async (req, res, next) => {
        const { email } = req.params;
        const userExists = await globalClient.checkUserExists(email);
        if (userExists) {
            return res.status(401).send('Unauthorized');
        }
    });
}