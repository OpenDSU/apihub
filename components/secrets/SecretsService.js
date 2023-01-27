const fs = require("fs");
const path = require("path");
const config = require("../../config");

function SecretsService(serverRootFolder) {
    const logger = $$.getLogger("secrets", "apihub/secrets");
    const crypto = require("opendsu").loadAPI("crypto");
    const createError = (code, message) => {
        const err = Error(message);
        err.code = code

        return err;
    }

    const encryptSecret = (secret) => {
        const encryptionKeys = process.env.SSO_SECRETS_ENCRYPTION_KEY.split(",");
        let latestEncryptionKey = encryptionKeys[0];
        if (!$$.Buffer.isBuffer(latestEncryptionKey)) {
            latestEncryptionKey = $$.Buffer.from(latestEncryptionKey, "base64");
        }

        return crypto.encrypt(secret, latestEncryptionKey);
    }

    const writeSecrets = (appName, secrets, callback) => {
        if (typeof secrets === "object") {
            secrets = JSON.stringify(secrets);
        }
        const encryptedSecrets = encryptSecret(secrets);
        fs.writeFile(getSecretFilePath(appName), encryptedSecrets, callback);
    }

    const ensureFolderExists = (folderPath, callback) => {
        fs.access(folderPath, (err) => {
            if (err) {
                fs.mkdir(folderPath, {recursive: true}, callback);
                return;
            }

            callback();
        })
    }

    const getStorageFolderPath = () => {
        return path.join(serverRootFolder, config.getConfig("externalStorage"), "secrets");
    }

    const getSecretFilePath = (appName) => {
        const folderPath = getStorageFolderPath(appName);
        return path.join(folderPath, `${appName}.secret`);
    }

    const decryptSecret = (appName, encryptedSecret, callback) => {
        const encryptionKeys = process.env.SSO_SECRETS_ENCRYPTION_KEY.split(",");
        const latestEncryptionKey = encryptionKeys[0].trim();
        let decryptedSecret;
        const _decryptSecretRecursively = (index) => {
            const encryptionKey = encryptionKeys[index].trim();
            if (typeof encryptionKey === "undefined") {
                logger.error(`Failed to decrypt secret. Invalid encryptionKey.`);
                callback(createError(500, `Failed to decrypt secret`));
                return;
            }
            let bufferEncryptionKey = encryptionKey;
            if (!$$.Buffer.isBuffer(bufferEncryptionKey)) {
                bufferEncryptionKey = $$.Buffer.from(bufferEncryptionKey, "base64");
            }

            try {
                decryptedSecret = crypto.decrypt(encryptedSecret, bufferEncryptionKey);
            } catch (e) {
                _decryptSecretRecursively(index + 1);
                return;
            }

            if (latestEncryptionKey !== encryptionKey) {
                logger.info(0x501, "Secrets Encryption Key rotation detected");
                writeSecrets(appName, decryptedSecret.toString(), err => {
                    if (err) {
                        logger.info(0x501, `Re-encrypting Recovery Passphases on disk file ${getSecretFilePath(appName)} failed due to error: ${err}`);
                        return callback(err);
                    }
                    logger.info(0x501, `Re-encrypting Recovery Passphases on disk file ${getSecretFilePath(appName)} completed`)
                    callback(undefined, decryptedSecret);
                });

                return;
            }

            callback(undefined, decryptedSecret);
        }

        _decryptSecretRecursively(0);
    }

    const getDecryptedSecrets = (appName, callback) => {
        const filePath = getSecretFilePath(appName);
        fs.readFile(filePath, (err, secrets) => {
            if (err) {
                logger.error(`Failed to read file ${filePath}`);
                return callback(createError(500, `Failed to read file ${filePath}`));
            }

            decryptSecret(appName, secrets, (err, decryptedSecrets) => {
                if (err) {
                    return callback(err);
                }

                try {
                    decryptedSecrets = JSON.parse(decryptedSecrets.toString());
                } catch (e) {
                    logger.error(`Failed to parse secrets`);
                    return callback(createError(500, `Failed to parse secrets`));
                }

                callback(undefined, decryptedSecrets);
            })
        });
    }

    this.putSecret = (appName, userId, secret, callback) => {
        if (typeof process.env.SSO_SECRETS_ENCRYPTION_KEY === "undefined") {
            logger.warn(`The SSO_SECRETS_ENCRYPTION_KEY is missing from environment.`);
            return callback(createError(500, `The SSO_SECRETS_ENCRYPTION_KEY is missing from environment.`));
        }
        const folderPath = getStorageFolderPath();
        ensureFolderExists(folderPath, err => {
            if (err) {
                return callback(createError(500, `Failed to store secret for user ${userId}`));
            }

            getDecryptedSecrets(appName, (err, decryptedSecrets) => {
                if (err) {
                    decryptedSecrets = {};
                }

                decryptedSecrets[userId] = secret;
                writeSecrets(appName, decryptedSecrets, callback);
            })
        })
    }

    this.getSecret = (appName, userId, callback) => {
        getDecryptedSecrets(appName, (err, decryptedSecrets) => {
            if (err) {
                return callback(err);
            }

            const secret = decryptedSecrets[userId];
            if (typeof secret === "undefined") {
                return callback(createError(404, `Secret for user ${userId} not found`));
            }

            callback(undefined, JSON.stringify({secret}));
        })
    }

    this.deleteSecret = (appName, userId, callback) => {
        getDecryptedSecrets(appName, (err, decryptedSecrets) => {
            if (err) {
                return callback(err);
            }

            delete decryptedSecrets[userId];
            writeSecrets(appName, decryptedSecrets, callback);
        })
    }
}

module.exports = SecretsService;
