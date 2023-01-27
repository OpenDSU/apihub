
function secrets(server) {
    const logger = $$.getLogger("secrets", "apihub/secrets");
    const httpUtils = require("../../libs/http-wrapper/src/httpUtils");
    const SecretsService = require("./SecretsService");
    const secretsService = new SecretsService(server.rootFolder);

    const getSSOSecret = (request, response) => {
        let userId = request.headers["user-id"];
        let appName = request.params.appName;
        secretsService.getSecret(appName, userId, (err, secret)=>{
            if (err) {
                response.statusCode = err.code;
                response.end(err.message);
                return;
            }

            response.statusCode = 200;
            response.end(secret);
        })
    }

    const putSSOSecret = (request, response) => {
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

        secretsService.putSecret(appName, userId, secret, err => {
            if (err) {
                response.statusCode = err.code;
                response.end(err.message);
                return;
            }

            response.statusCode = 200;
            response.end();
        });
    };

    const getUserIdFromDID = (did, appName) => {
        const crypto = require("opendsu").loadAPI("crypto");
        const decodedDID = crypto.decodeBase58(did);
        const splitDecodedDID = decodedDID.split(":");
        let name = splitDecodedDID.slice(3).join(":");
        let userId = name.slice(appName.length + 1);
        return userId;
    }

    const deleteSSOSecret = (request, response) => {
        let did = request.params.did;
        let appName = request.params.appName;
        let userId = getUserIdFromDID(did, appName);

        secretsService.deleteSecret(appName, userId, err => {
            if (err) {
                response.statusCode = err.code;
                response.end(err.message);
                return;
            }

            response.statusCode = 200;
            response.end();
        });
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

    logEncryptionTest();
    server.put('/putSSOSecret/*', httpUtils.bodyParser);
    server.get("/getSSOSecret/:appName", getSSOSecret);
    server.put('/putSSOSecret/:appName', putSSOSecret);
    server.delete("/deactivateSSOSecret/:appName/:did", deleteSSOSecret);
    server.delete("/removeSSOSecret/:appName/:did", deleteSSOSecret);
}

module.exports = secrets;
