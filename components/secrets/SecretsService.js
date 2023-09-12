const fs = require("fs");
const path = require("path");
const config = require("../../config");


function SecretsService(serverRootFolder) {
    const getStorageFolderPath = () => {
        return path.join(serverRootFolder, config.getConfig("externalStorage"), "secrets");
    }

    const lockPath = path.join(getStorageFolderPath(), "secret.lock");
    const lock = require("../../utils/ExpiringFileLock").getLock(lockPath, 60000);
    console.log("Secrets Service initialized");
    const logger = $$.getLogger("secrets", "apihub/secrets");
    const openDSU = require("opendsu");
    const crypto = openDSU.loadAPI("crypto");
    const encryptionKeys = process.env.SSO_SECRETS_ENCRYPTION_KEY.split(",");
    let latestEncryptionKey = encryptionKeys[0].trim();
    let successfulEncryptionKeyIndex = 0;
    const containers = {};

    const loadContainerAsync = async (containerName) => {
        try {
            containers[containerName] = await getDecryptedSecretsAsync(containerName);
            console.info("Secrets container", containerName, "loaded");
        } catch (e) {
            containers[containerName] = {};
            console.info("Initializing secrets container", containerName);
        }
    }

    this.loadContainersAsync = async () => {
        ensureFolderExists(getStorageFolderPath());
        let secretsContainersNames = fs.readdirSync(getStorageFolderPath());
        if (secretsContainersNames.length) {
            secretsContainersNames = secretsContainersNames.map((containerName) => {
                const extIndex = containerName.lastIndexOf(".");
                return path.basename(containerName).substring(0, extIndex);
            })

            for (let containerName of secretsContainersNames) {
                await loadContainerAsync(containerName);
            }
        } else {
            logger.info("No secrets containers found");
        }
    }

    this.forceWriteSecretsAsync = async () => {
        ensureFolderExists(getStorageFolderPath());
        let secretsContainersNames = fs.readdirSync(getStorageFolderPath());
        if (secretsContainersNames.length) {
            secretsContainersNames = secretsContainersNames.map((containerName) => {
                const extIndex = containerName.lastIndexOf(".");
                return path.basename(containerName).substring(0, extIndex);
            })

            for (let containerName of secretsContainersNames) {
                await writeSecretsAsync(containerName);
            }
        } else {
            logger.info("No secrets containers found");
        }
    }
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

    const writeSecrets = (secretsContainerName, callback) => {
        let secrets = containers[secretsContainerName];
        secrets = JSON.stringify(secrets);
        const encryptedSecrets = encryptSecret(secrets);
        fs.writeFile(getSecretFilePath(secretsContainerName), encryptedSecrets, callback);
    }

    const writeSecretsAsync = async (secretsContainerName) => {
        return await $$.promisify(writeSecrets)(secretsContainerName);
    }
    const ensureFolderExists = (folderPath) => {
        try {
            fs.accessSync(folderPath);
        } catch (e) {
            fs.mkdirSync(folderPath, {recursive: true});
        }
    }


    const getSecretFilePath = (secretsContainerName) => {
        const folderPath = getStorageFolderPath(secretsContainerName);
        return path.join(folderPath, `${secretsContainerName}.secret`);
    }

    const decryptSecret = async (secretsContainerName, encryptedSecret) => {
        let bufferEncryptionKey = latestEncryptionKey;
        if (!$$.Buffer.isBuffer(bufferEncryptionKey)) {
            bufferEncryptionKey = $$.Buffer.from(bufferEncryptionKey, "base64");
        }

        return crypto.decrypt(encryptedSecret, bufferEncryptionKey);
    };

    const getDecryptedSecrets = (secretsContainerName, callback) => {
        const filePath = getSecretFilePath(secretsContainerName);
        fs.readFile(filePath, async (err, secrets) => {
            if (err) {
                logger.error(`Failed to read file ${filePath}`);
                return callback(createError(500, `Failed to read file ${filePath}`));
            }

            let decryptedSecrets;
            try {
                decryptedSecrets = await decryptSecret(secretsContainerName, secrets);
            } catch (e) {
                logger.error(`Failed to decrypt secrets`);
                return callback(createError(500, `Failed to decrypt secrets`));
            }

            try {
                decryptedSecrets = JSON.parse(decryptedSecrets.toString());
            } catch (e) {
                logger.error(`Failed to parse secrets`);
                return callback(createError(500, `Failed to parse secrets`));
            }

            callback(undefined, decryptedSecrets);
        });
    }

    const getDecryptedSecretsAsync = async (secretsContainerName) => {
        return await $$.promisify(getDecryptedSecrets, this)(secretsContainerName);
    }

    this.putSecretAsync = async (secretsContainerName, userId, secret) => {
        await lock.lock();
        let res;
        try {
            await loadContainerAsync(secretsContainerName);
            if (!containers[secretsContainerName]) {
                containers[secretsContainerName] = {};
                console.info("Initializing secrets container", secretsContainerName)
            }
            containers[secretsContainerName][userId] = secret;
            res = await writeSecretsAsync(secretsContainerName, userId);
        } catch (e) {
            await lock.unlock();
            throw e;
        }
        await lock.unlock();
        return res;
    }

    this.getSecretSync = (secretsContainerName, userId) => {
        if (!containers[secretsContainerName]) {
            containers[secretsContainerName] = {};
            console.info("Initializing secrets container", secretsContainerName)
        }
        const secret = containers[secretsContainerName][userId];
        if (!secret) {
            throw createError(404, `Secret for user ${userId} not found`);
        }

        return secret;
    }

    this.deleteSecretAsync = async (secretsContainerName, userId) => {
        await lock.lock();
        let res;
        try {
            await loadContainerAsync(secretsContainerName);
            if (!containers[secretsContainerName]) {
                containers[secretsContainerName] = {};
                console.info("Initializing secrets container", secretsContainerName)
            }
            if (!containers[secretsContainerName][userId]) {
                throw createError(404, `Secret for user ${userId} not found`);
            }
            delete containers[secretsContainerName][userId];
            await writeSecretsAsync(secretsContainerName);
        } catch (e) {
            await lock.unlock();
            throw e;
        }
        await lock.unlock();
        return res;
    }

    this.rotateKeyAsync = async () => {
        let writeKey = encryptionKeys[0].trim();
        let readKey = encryptionKeys.length === 2 ? encryptionKeys[1].trim() : writeKey;
        const rotationIsNeeded = async () => {
            let secretsContainersNames = fs.readdirSync(getStorageFolderPath());
            if (secretsContainersNames.length) {
                secretsContainersNames = secretsContainersNames.map((containerName) => {
                    const extIndex = containerName.lastIndexOf(".");
                    return path.basename(containerName).substring(0, extIndex);
                })

                const containerName = secretsContainersNames[0];
                try{
                    await $$.promisify(getDecryptedSecrets)(containerName);
                }catch (e) {
                    return true;
                }
            } else {
                logger.info("No secrets containers found");
            }
        }

        if (await rotationIsNeeded()) {
            logger.info(0x501, "Secrets Encryption Key rotation detected");
            latestEncryptionKey = readKey;
            await this.loadContainersAsync();
            latestEncryptionKey = writeKey;
            await this.forceWriteSecretsAsync();
            logger.info(0x501, `Re-encrypting Recovery Passphrases on disk completed`)
        }
    }
}

const getSecretsServiceInstanceAsync = async (serverRootFolder) => {
    const secretsService = new SecretsService(serverRootFolder);
    await secretsService.loadContainersAsync();
    return secretsService;
}

module.exports = {
    getSecretsServiceInstanceAsync
};
