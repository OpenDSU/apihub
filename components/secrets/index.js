function secrets(server) {
    const openDSU = require("opendsu");
    const crypto = openDSU.loadAPI("crypto");
    const constants = require("./constants");
    const CONTAINERS = constants.CONTAINERS;
    const whitelistedContainers = [CONTAINERS.DSU_FABRIC, CONTAINERS.DEMIURGE];
    const whitelistedSecrets = ["credential"];
    const logger = $$.getLogger("secrets", "apihub/secrets");
    const httpUtils = require("../../http-wrapper/src/httpUtils");
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
            response.end("Forbidden getSSOSecret");
            return;
        }
        let secret;
        try {
            secret = secretsService.getSecretSync(appName, userId);
        } catch (e) {
            response.statusCode = e.code;
            response.end("Fail");
            return;
        }

        response.statusCode = 200;
        response.setHeader("Content-type", "text/plain");
        response.end(secret);
    }

    const putSSOSecret = async (request, response) => {
        let userId = request.headers["user-id"];
        let appName = request.params.appName;
        let secret;
        try {
            secret = JSON.parse(request.body).secret;
        } catch (e) {
            logger.error("Failed to parse body", e);
            response.statusCode = 500;
            response.end("Fail");
            return;
        }

        try {
            await secretsService.putSecretAsync(appName, userId, secret);
        } catch (e) {
            response.statusCode = e.code;
            response.end("Fail");
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
            response.end("Fail");
            return;
        }

        response.statusCode = 200;
        response.end();
    }

    const logEncryptionTest = () => {
        const key = "presetEncryptionKeyForInitialLog";
        const text = "TheQuickBrownFoxJumpedOverTheLazyDog";

        logger.info(0x500, "Recovery Passphrase Encryption Check. Plain text: " + text);
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
            console.error(e);
            res.statusCode = e.code;
            res.end("Failed to put did secret");
            return;
        }
        res.statusCode = 200;
        res.end();
    }

    function getDIDSecret(req, res) {
        let {did, name} = req.params;
        if (!containerIsWhitelisted(did) && !secretIsWhitelisted(name)) {
            res.statusCode = 403;
            res.end("Forbidden getDIDSecret");
            return;
        }
        let secret;
        try {
            secret = secretsService.getSecretSync(name, did);
            res.statusCode = 200;
        } catch (err) {
            console.error(err);
            res.statusCode = err.code;
            res.end("Failed to get DID secret");
            return;
        }
        res.setHeader("Content-type", "text/plain");
        res.end(secret);
    }

    async function deleteDIDSecret(req, res) {
        let {did, name} = req.params;
        try {
            await secretsService.deleteSecretAsync(name, did)
            res.statusCode = 200;
        } catch (err) {
            console.error(err);
            res.statusCode = err.code;
            res.end("Failed to delete DID secret");
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

    server.head("/apiKey/:keyId", (req, res) => {
        let {keyId} = req.params;
        let exists;
        try {
            exists = secretsService.getSecretSync(CONTAINERS.API_KEY_CONTAINER_NAME, keyId);
        } catch (e) {
            exists = false;
        }
        res.statusCode = exists ? 200 : 404;
        res.end();
    });

    server.post("/apiKey/*", httpUtils.bodyParser);
    server.post("/apiKey/:keyId/:isAdmin", async (req, res) => {
        if (!senderIsAdmin(req)) {
            res.statusCode = 403;
            res.end("Forbidden isAdmin");
            return;
        }
        let {keyId, isAdmin} = req.params;
        // check if an API key already exists for the given keyId
        if (!secretsService.containerIsEmpty(CONTAINERS.API_KEY_CONTAINER_NAME)) {
            let existingAPIKey;
            try {
                existingAPIKey = secretsService.getSecretSync(CONTAINERS.API_KEY_CONTAINER_NAME, keyId);
            } catch (e) {

            }
            if (existingAPIKey) {
                res.statusCode = 409;
                res.end("API key already exists for the given keyId.");
                return;
            }
        }
        // generate a new API key
        const apiKey = await secretsService.generateAPIKeyAsync(keyId, isAdmin === "true")
        res.statusCode = 200;
        res.setHeader("Content-type", "text/plain");
        res.end(apiKey);
    });

    server.delete("/apiKey/:keyId", async (req, res) => {
        if (!senderIsAdmin(req)) {
            res.statusCode = 403;
            res.end("Forbidden deleteAPIKey");
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
            let body = req.body;
            try {
                body = JSON.parse(body);
            } catch (e) {
                res.statusCode = 400;
                res.end("Body should be a valid JSON object.");
                return;
            }

            if (!body.secret || !body.apiKey) {
                res.statusCode = 400;
                res.end("Body should contain secret and apiKey fields.");
                return;
            }

            const adminContainerIsEmpty = secretsService.containerIsEmpty(CONTAINERS.ADMIN_API_KEY_CONTAINER_NAME);
            if (adminContainerIsEmpty) {
                await secretsService.putSecretAsync(CONTAINERS.ADMIN_API_KEY_CONTAINER_NAME, req.headers["user-id"], req.body);
                await secretsService.putSecretAsync(CONTAINERS.API_KEY_CONTAINER_NAME, constants.SYSADMIN_SECRET, body.secret);
                res.statusCode = 200;
                res.end('System administrator added successfully.');
                return;
            }

            const sysadminSecret = secretsService.getSecretSync(CONTAINERS.API_KEY_CONTAINER_NAME, constants.SYSADMIN_SECRET);
            if (sysadminSecret === body.secret) {
                await secretsService.putSecretAsync(CONTAINERS.ADMIN_API_KEY_CONTAINER_NAME, req.headers["user-id"], body.apiKey);
                res.statusCode = 200;
                res.end('System administrator added successfully.');
                return;
            }

            res.statusCode = 403;
            res.end("Forbidden becomeSysAdmin");
        } catch (error) {
            console.error(error);
            res.statusCode = 500;
            res.end("Failed");
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
                res.end("Forbidden makeSysAdmin");
                return;
            }

            await secretsService.putSecretAsync(constants.CONTAINERS.ADMIN_API_KEY_CONTAINER_NAME, userId, req.body);
            res.statusCode = 200;
            res.end('System administrator added successfully.');
        } catch (error) {
            console.error(error);
            res.statusCode = 500;
            res.end("Failed");
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
                res.end("Forbidden deleteAdmin");
                return;
            }

            await secretsService.deleteSecretAsync(constants.CONTAINERS.ADMIN_API_KEY_CONTAINER_NAME, userId);
            res.statusCode = 200;
            res.end('System administrator added successfully.');
        } catch (error) {
            console.error(error);
            res.statusCode = 500;
            res.end("Failed");
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
            if (!secret) {
                secret = {}
                secret[name] = req.body;
            }
            await secretsService.putSecretAsync(CONTAINERS.USER_API_KEY_CONTAINER_NAME, secretName, JSON.stringify(secret));
            res.statusCode = 200;
            res.end('API key associated successfully.');
        } catch (error) {
            console.error(error);
            res.statusCode = 500;
            res.end("Failed to associate API key");
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
            } catch (e) {
                // ignored and handled below
            }
            if (!secret) {
                res.statusCode = 404;
                res.end('API key not found.');
                return;
            }
            delete secret[name];
            if (Object.keys(secret).length === 0) {
                await secretsService.deleteSecretAsync(CONTAINERS.USER_API_KEY_CONTAINER_NAME, secretName);
                res.statusCode = 200;
                res.end('API key deleted successfully.');
                return;
            }

            await secretsService.putSecretAsync(CONTAINERS.USER_API_KEY_CONTAINER_NAME, secretName, JSON.stringify(secret));
            res.statusCode = 200;
            res.end('API key deleted successfully.');
        } catch (error) {
            console.error(error);
            res.statusCode = 500;
            res.end("Failed to delete API key");
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
            if (!secret[name]) {
                res.statusCode = 404;
                res.end('API key not found.');
                return;
            }

            res.statusCode = 200;
            res.setHeader("Content-type", "text/plain");
            res.end(secret[name]);
        } catch (error) {
            console.error(error);
            res.statusCode = 500;
            res.end("Failed to read API key");
        }
    });

    server.get('/userHasAccess/:appName/:scope/:userId', async (req, res) => {
        const appName = decodeURIComponent(req.params.appName);
        const scope = decodeURIComponent(req.params.scope);
        const userId = decodeURIComponent(req.params.userId);
        try {
            const secretName = crypto.sha256JOSE(appName + userId, "base64url");
            let secret;
            let apiKey;
            try {
                secret = secretsService.getSecretSync(CONTAINERS.USER_API_KEY_CONTAINER_NAME, secretName);
                secret = JSON.parse(secret);
                apiKey = JSON.parse(Object.values(secret)[0]);
            } catch (e) {
                res.statusCode = 200;
                res.end('false');
                return;
            }
            if (!apiKey.scope || apiKey.scope !== scope) {
                res.statusCode = 200;
                res.end('false');
                return;
            }

            res.statusCode = 200;
            res.end('true');
        } catch (error) {
            console.error(error);
            res.statusCode = 500;
            res.end('Failed to check user access.');
        }
    })

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
