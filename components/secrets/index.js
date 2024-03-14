function secrets(server) {
    const openDSU = require("opendsu");
    const crypto = openDSU.loadAPI("crypto");
    const whitelistedContainers = ["DSU_Fabric", "Demiurge"];
    const whitelistedSecrets = ["credential"];
    const logger = $$.getLogger("secrets", "apihub/secrets");
    const httpUtils = require("../../libs/http-wrapper/src/httpUtils");
    const constants = require("./constants");
    const CONTAINERS = constants.CONTAINERS;
    const SecretsService = require("./SecretsService");
    let secretsService;
    setTimeout(async () => {
        secretsService = await SecretsService.getSecretsServiceInstanceAsync(server.rootFolder);
    })

    const containerIsWhitelisted = (containerName) => {
        return whitelistedContainers.includes(containerName);
    }

    const secretIsWhitelisted = (secretName) => {
        return whitelistedSecrets.includes(secretName);
    }

    const getSSOSecret = (request, response) => {
        let userId = request.headers["user-id"];
        let appName = request.params.appName;
        if (!containerIsWhitelisted(appName) && !secretIsWhitelisted(userId)) {
            response.statusCode = 403;
            response.end("Forbidden");
            return;
        }
        let secret;
        try {
            secret = secretsService.getSecretSync(appName, userId);
        } catch (e) {
            response.statusCode = e.code;
            response.end(e.message);
            return;
        }

        response.statusCode = 200;
        response.end(secret);
    }

    const putSSOSecret = async (request, response) => {
        let userId = request.headers["user-id"];
        let appName = request.params.appName;
        let secret;
        try {
            secret = JSON.parse(request.body).secret;
        } catch (e) {
            logger.error("Failed to parse body", request.body);
            response.statusCode = 500;
            response.end(e);
            return;
        }

        try {
            await secretsService.putSecretAsync(appName, userId, secret);
        } catch (e) {
            response.statusCode = e.code;
            response.end(e.message);
            return;
        }

        response.statusCode = 200;
        response.end();
    };

    const deleteSSOSecret = async (request, response) => {
        let appName = request.params.appName;
        let userId = request.headers["user-id"];

        try {
            await secretsService.deleteSecretAsync(appName, userId);
        } catch (e) {
            response.statusCode = e.code;
            response.end(e.message);
            return;
        }

        response.statusCode = 200;
        response.end();
    }

    const logEncryptionTest = () => {
        const key = "presetEncryptionKeyForInitialLog";
        const text = "TheQuickBrownFoxJumpedOverTheLazyDog";

        logger.info(0x500, "Recovery Passphrase Encryption Check\nPlain text: " + text);
        logger.info(0x500, "Preset encryption key: " + key);

        const filePath = require("path").join(server.rootFolder, "initialEncryptionTest");
        const encryptedText = require("opendsu").loadAPI("crypto").encrypt(text, key).toString("hex");

        logger.info(0x500, "Writing encrypted file on disk: " + filePath);
        logger.info(0x500, "Cipher text(file contents): " + encryptedText);

        require("fs").writeFile(filePath, encryptedText, (err) => {
            if (err) {
                logger.info(0x500, "Failed to write file: " + filePath + " Error: " + err);
            }
        });
    }

    async function putDIDSecret(req, res) {
        let {did, name} = req.params;
        let secret = req.body;
        try {
            await secretsService.putSecretAsync(name, did, secret);
        } catch (e) {
            res.statusCode = e.code;
            res.end(e.message);
            return;
        }
        res.statusCode = 200;
        res.end();
    }

    function getDIDSecret(req, res) {
        let {did, name} = req.params;
        if (!containerIsWhitelisted(did) && !secretIsWhitelisted(name)) {
            res.statusCode = 403;
            res.end("Forbidden");
            return;
        }
        let secret;
        try {
            secret = secretsService.getSecretSync(name, did);
            res.statusCode = 200;
        } catch (err) {
            res.statusCode = err.code;
            res.end(err.message);
            return;
        }
        res.end(secret);
    }

    async function deleteDIDSecret(req, res) {
        let {did, name} = req.params;
        try {
            await secretsService.deleteSecretAsync(name, did)
            res.statusCode = 200;
        } catch (err) {
            res.statusCode = err.code;
            res.end(err.message);
            return;
        }

        res.end();
    }

    logEncryptionTest();

    const senderIsAdmin = (req) => {
        const authorizationHeader = req.headers.authorization;
        if (!authorizationHeader) {
            return !!secretsService.apiKeysContainerIsEmpty();
        }

        return secretsService.isAdminAPIKey(authorizationHeader);
    }

    server.post("/apiKey/*", httpUtils.bodyParser);
    server.post("/apiKey/:keyId/:isAdmin", async (req, res) => {
        if (!senderIsAdmin(req)) {
            res.statusCode = 403;
            res.end("Forbidden");
            return;
        }
        let {keyId, isAdmin} = req.params;
        const apiKey = await secretsService.generateAPIKeyAsync(keyId, isAdmin === "true")
        res.statusCode = 200;
        res.end(apiKey);
    });

    server.delete("/apiKey/:keyId", async (req, res) => {
        if (!senderIsAdmin(req)) {
            res.statusCode = 403;
            res.end("Forbidden");
            return;
        }
        let {keyId} = req.params;
        await secretsService.deleteAPIKeyAsync(keyId);
        res.statusCode = 200;
        res.end();
    })

    server.put('/becomeSysAdmin', httpUtils.bodyParser);
    server.put('/becomeSysAdmin', async (req, res) => {
        try {
            // Logic to check if a system administrator exists and add a new Admin API Key
            const adminContainerIsEmpty = secretsService.containerIsEmpty(CONTAINERS.ADMIN_API_KEY_CONTAINER_NAME);

            if (!adminContainerIsEmpty) {
                res.statusCode = 403;
                res.end("Forbidden");
                return;
            }

            await secretsService.putSecretAsync(CONTAINERS.ADMIN_API_KEY_CONTAINER_NAME, req.headers["user-id"], req.body);
            res.statusCode = 200;
            res.end('System administrator added successfully.');
        } catch (error) {
            res.statusCode = 500;
            res.end(error.message);
        }
    });

    server.put('/makeSysAdmin/:userId', httpUtils.bodyParser);
    server.put('/makeSysAdmin/:userId', async (req, res) => {
        const userId = decodeURIComponent(req.params.userId);
        try {
            // Create a new Admin APIKey and associate it with another user
            let sysadminAPIKey;
            try {
                sysadminAPIKey = secretsService.getSecretSync(constants.CONTAINERS.ADMIN_API_KEY_CONTAINER_NAME, req.headers["user-id"]);
            } catch (e) {
                console.log(e)
                // ignored and handled below
            }

            if (!sysadminAPIKey) {
                res.statusCode = 403;
                res.end("Forbidden");
                return;
            }

            await secretsService.putSecretAsync(constants.CONTAINERS.ADMIN_API_KEY_CONTAINER_NAME, userId, req.body);
            res.statusCode = 200;
            res.end('System administrator added successfully.');
        } catch (error) {
            res.statusCode = 500;
            res.end(error.message);
        }
    });


    server.delete('/deleteAdmin/:userId', async (req, res) => {
        const userId = decodeURIComponent(req.params.userId);
        try {
            let sysadminAPIKey;
            try {
                sysadminAPIKey = secretsService.getSecretSync(constants.CONTAINERS.ADMIN_API_KEY_CONTAINER_NAME, req.headers["user-id"]);
            } catch (e) {
                // ignored and handled below
            }

            if (!sysadminAPIKey) {
                res.statusCode = 403;
                res.end("Forbidden");
                return;
            }

            await secretsService.deleteSecretAsync(constants.CONTAINERS.ADMIN_API_KEY_CONTAINER_NAME, userId);
            res.statusCode = 200;
            res.end('System administrator added successfully.');
        } catch (error) {
            res.statusCode = 500;
            res.end(error.message);
        }
    });


    server.put('/associateAPIKey/*', httpUtils.bodyParser);
    server.put('/associateAPIKey/:appName/:name/:userId', async (req, res) => {
        const appName = decodeURIComponent(req.params.appName);
        const name = decodeURIComponent(req.params.name);
        const userId = decodeURIComponent(req.params.userId);
        try {
            const secretName = crypto.sha256JOSE(appName + userId, "base64url");
            let secret;
            try {
                secret = secretsService.getSecretSync(CONTAINERS.USER_API_KEY_CONTAINER_NAME, secretName);
                secret = JSON.parse(secret);
            } catch (e) {
                // ignored and handled below
            }
            if(!secret){
                secret = {}
                secret[name] = req.body;
            }
            await secretsService.putSecretAsync(CONTAINERS.USER_API_KEY_CONTAINER_NAME, secretName, JSON.stringify(secret));
            res.statusCode = 200;
            res.end('API key associated successfully.');
        } catch (error) {
            res.statusCode = 500;
            res.end(error.message);
        }
    });


    server.delete('/deleteAPIKey/:appName/:name/:userId', async (req, res) => {
        const appName = decodeURIComponent(req.params.appName);
        const name = decodeURIComponent(req.params.name);
        const userId = decodeURIComponent(req.params.userId);
        try {
            const secretName = crypto.sha256JOSE(appName + userId, "base64url");
            let secret;
            try {
                secret = secretsService.getSecretSync(CONTAINERS.USER_API_KEY_CONTAINER_NAME, secretName);
                secret = JSON.parse(secret);
            }catch (e) {
                // ignored and handled below
            }
            if(!secret){
                res.statusCode = 404;
                res.end('API key not found.');
                return;
            }
            delete secret[name];
            await secretsService.putSecretAsync(CONTAINERS.USER_API_KEY_CONTAINER_NAME, secretName, JSON.stringify(secret));
            res.statusCode = 200;
            res.end('API key deleted successfully.');
        } catch (error) {
            res.statusCode = 500;
            res.end(error.message);
        }
    });

    server.get('/getAPIKey/:appName/:name/:userId', async (req, res) => {
        const appName = decodeURIComponent(req.params.appName);
        const name = decodeURIComponent(req.params.name);
        const userId = decodeURIComponent(req.params.userId);
        try {
            const secretName = crypto.sha256JOSE(appName + userId, "base64url");
            let secret;
            try {
                secret = secretsService.getSecretSync(CONTAINERS.USER_API_KEY_CONTAINER_NAME, secretName);
                secret = JSON.parse(secret);
            } catch (e) {
                res.statusCode = 404;
                res.end('API key not found.');
                return;
            }
            if(!secret[name]){
                res.statusCode = 404;
                res.end('API key not found.');
                return;
            }

            res.statusCode = 200;
            res.end(secret[name]);
        } catch (error) {
            res.statusCode = 500;
            res.end(error.message);
        }
    });

    server.put('/putSSOSecret/*', httpUtils.bodyParser);
    server.get("/getSSOSecret/:appName", getSSOSecret);
    server.put('/putSSOSecret/:appName', putSSOSecret);
    server.delete("/deactivateSSOSecret/:appName/:did", deleteSSOSecret);
    server.delete("/removeSSOSecret/:appName", deleteSSOSecret);

    server.put('/putDIDSecret/*', httpUtils.bodyParser);
    server.put('/putDIDSecret/:did/:name', putDIDSecret);
    server.get('/getDIDSecret/:did/:name', getDIDSecret);
    server.delete('/removeDIDSecret/:did/:name', deleteDIDSecret);
}

module.exports = secrets;
