const fs = require("fs");
const path = require("path");
const config = require("../../http-wrapper/config");
const {CONTAINERS} = require("./constants");


function SecretsService(serverRootFolder) {
    serverRootFolder = serverRootFolder || config.getConfig("storage");
    const DEFAULT_CONTAINER_NAME = "default";
    const API_KEY_CONTAINER_NAME = "apiKeys";
    const getStorageFolderPath = () => {
        return path.join(serverRootFolder, config.getConfig("externalStorage"), "secrets");
    }

    const lockPath = path.join(getStorageFolderPath(), "secret.lock");
    const lock = require("../../http-wrapper/utils/ExpiringFileLock").getLock(lockPath, 10000);
    console.log("Secrets Service initialized");
    const logger = $$.getLogger("secrets", "apihub/secrets");
    const openDSU = require("opendsu");
    const crypto = openDSU.loadAPI("crypto");
    const encryptionKeys = process.env.SSO_SECRETS_ENCRYPTION_KEY ? process.env.SSO_SECRETS_ENCRYPTION_KEY.split(",") : undefined;
    let readonlyMode;

    let writeEncryptionKey = encryptionKeys ? encryptionKeys[0].trim() : undefined;
    if (typeof writeEncryptionKey === "undefined") {
        readonlyMode = true;
        console.warn("No encryption key found. Readonly mode activated");
        return;
    }
    writeEncryptionKey = $$.Buffer.from(writeEncryptionKey, "base64");

    let previousEncryptionKey = encryptionKeys.length === 2 ? encryptionKeys[1].trim() : undefined;
    if (typeof previousEncryptionKey !== "undefined") {
        previousEncryptionKey = $$.Buffer.from(previousEncryptionKey, "base64");
    }
    const containers = {};

    const apiKeyExists = (apiKeysContainer, apiKey) => {
        const apiKeys = Object.values(apiKeysContainer);
        if (apiKeys.length === 0) {
            return false;
        }

        let index = apiKeys.findIndex(el => {
            if (typeof el === "string") {
                return el === apiKey;
            }
            return el.secret === apiKey;
        });
        return index !== -1;
    }

    const loadContainerAsync = async (containerName) => {
        try {
            containers[containerName] = await getDecryptedSecretsAsync(containerName);
            console.info("Secrets container", containerName, "loaded");
        } catch (e) {
            containers[containerName] = {};
            console.info("Initializing secrets container", containerName);
        }

        if (containerName === API_KEY_CONTAINER_NAME) {
            const apiKey = require("opendsu").loadAPI("crypto").sha256JOSE(process.env.SSO_SECRETS_ENCRYPTION_KEY, "base64");
            if (!apiKeyExists(containers[containerName], apiKey)) {
                console.log("API Key not found in container", containerName);
                containers[containerName][apiKey] = apiKey;
                await writeSecretsAsync(containerName);
            }
        }
    }

    this.loadAsync = async () => {
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

    const createError = (code, message) => {
        const err = Error(message);
        err.code = code

        return err;
    }

    const encryptSecret = (secret) => {
        return crypto.encrypt(secret, writeEncryptionKey);
    }

    const writeSecrets = (secretsContainerName, callback) => {
        if (readonlyMode) {
            return callback(createError(555, `Secrets Service is in readonly mode`));
        }
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
        const folderPath = getStorageFolderPath();
        return path.join(folderPath, `${secretsContainerName}.secret`);
    }

    const decryptAndParseSecrets = (secretsContainerName, encryptedSecret, encryptionKey) => {
        let decryptedSecrets;
        try {
            decryptedSecrets = crypto.decrypt(encryptedSecret, encryptionKey);
            decryptedSecrets = JSON.parse(decryptedSecrets.toString());
            containers[secretsContainerName] = decryptedSecrets;
            return decryptedSecrets;
        } catch (e) {
            logger.error(`Failed to parse secrets`);
            throw createError(555, `Failed to parse secrets`);
        }
    }
    const decryptSecret = async (secretsContainerName, encryptedSecret) => {
        let decryptedSecret;
        try {
            decryptedSecret = decryptAndParseSecrets(secretsContainerName, encryptedSecret, writeEncryptionKey);
            readonlyMode = false;
            return decryptedSecret;
        } catch (e) {
            try {
                decryptedSecret = decryptAndParseSecrets(secretsContainerName, encryptedSecret, previousEncryptionKey);
                logger.info(0x501, "Secrets Encryption Key rotation detected");
                await writeSecretsAsync(secretsContainerName);
                logger.info(0x501, `Re-encrypting Recovery Passphrases on disk completed`);
                readonlyMode = false;
                return decryptedSecret;
            } catch (e) {
                logger.error(`Failed to decrypt secrets`);
                readonlyMode = true;
                console.log("Readonly mode activated")
                throw createError(555, `Failed to decrypt secrets`);
            }
        }
    };

    const getDecryptedSecrets = (secretsContainerName, callback) => {
        const filePath = getSecretFilePath(secretsContainerName);
        fs.readFile(filePath, async (err, secrets) => {
            if (err || !secrets) {
                logger.log(`Failed to read file ${filePath}`);
                return callback(createError(404, `Failed to read file ${filePath}`));
            }

            let decryptedSecrets;
            try {
                decryptedSecrets = await decryptSecret(secretsContainerName, secrets);
            } catch (e) {
                return callback(e);
            }

            callback(undefined, decryptedSecrets);
        });
    }

    const getDecryptedSecretsAsync = async (secretsContainerName) => {
        return await $$.promisify(getDecryptedSecrets, this)(secretsContainerName);
    }

    this.putSecretAsync = async (secretsContainerName, secretName, secret, isAdmin) => {
        await lock.lock();
        let res;
        try {
            await loadContainerAsync(secretsContainerName);
            if (!containers[secretsContainerName]) {
                containers[secretsContainerName] = {};
                console.info("Initializing secrets container", secretsContainerName)
            }
            if (typeof isAdmin !== "undefined") {
                containers[secretsContainerName][secretName] = {};
                containers[secretsContainerName][secretName].secret = secret;
                containers[secretsContainerName][secretName].isAdmin = isAdmin;
            } else {
                containers[secretsContainerName][secretName] = secret;
            }
            res = await writeSecretsAsync(secretsContainerName);
        } catch (e) {
            await lock.unlock();
            throw e;
        }
        await lock.unlock();
        return res;
    }

    this.putSecretInDefaultContainerAsync = async (secretName, secret) => {
        return await this.putSecretAsync(DEFAULT_CONTAINER_NAME, secretName, secret);
    }

    this.getSecretSync = (secretsContainerName, secretName) => {
        if (readonlyMode) {
            throw createError(555, `Secrets Service is in readonly mode`);
        }
        if (!containers[secretsContainerName]) {
            containers[secretsContainerName] = {};
            console.info("Initializing secrets container", secretsContainerName);
        }
        const secret = containers[secretsContainerName][secretName];
        if (!secret) {
            throw createError(404, `Secret ${secretName} not found`);
        }

        return secret;
    }

    this.readSecretSync = this.getSecretSync;

    this.getSecretFromDefaultContainerSync = (secretName) => {
        return this.getSecretSync(DEFAULT_CONTAINER_NAME, secretName);
    }

    this.readSecretFromDefaultContainerSync = this.getSecretFromDefaultContainerSync;

    this.generateAPIKeyAsync = async (keyId, isAdmin) => {
        const apiKey = crypto.generateRandom(32).toString("base64");
        await this.putSecretAsync(API_KEY_CONTAINER_NAME, keyId, apiKey, isAdmin);
        return apiKey;
    }

    this.deleteAPIKeyAsync = async (keyId) => {
        await this.deleteSecretAsync(API_KEY_CONTAINER_NAME, keyId);
    }

    this.containerIsEmpty = (secretsContainerName) => {
        return Object.keys(containers[secretsContainerName] || {}).length === 0;
    }

    this.apiKeysContainerIsEmpty = () => {
        return this.containerIsEmpty(API_KEY_CONTAINER_NAME);
    }

    this.validateAPIKey = async (apiKey) => {
        console.debug("Validating internal call");
        if(apiKey === process.env.SSO_SECRETS_ENCRYPTION_KEY){
            return true;
        }
        await loadContainerAsync(CONTAINERS.API_KEY_CONTAINER_NAME);
        const container = containers[API_KEY_CONTAINER_NAME];
        if (!container) {
            return false;
        }

        return apiKeyExists(container, apiKey);
    }

    this.isAdminAPIKey = (apiKey) => {
        const container = containers[API_KEY_CONTAINER_NAME];
        if (!container) {
            return false;
        }
        const apiKeyObjs = Object.values(container);
        if (apiKeyObjs.length === 0) {
            return false;
        }
        let index = apiKeyObjs.findIndex((obj) => {
            return obj.secret === apiKey && obj.isAdmin;
        });
        return index !== -1;
    }

    this.deleteSecretAsync = async (secretsContainerName, secretName) => {
        await lock.lock();
        try {
            await loadContainerAsync(secretsContainerName);
            if (!containers[secretsContainerName]) {
                containers[secretsContainerName] = {};
                console.info("Initializing secrets container", secretsContainerName)
            }
            if (!containers[secretsContainerName][secretName]) {
                throw createError(404, `Secret ${secretName} not found`);
            }
            delete containers[secretsContainerName][secretName];
            await writeSecretsAsync(secretsContainerName);
        } catch (e) {
            await lock.unlock();
            throw e;
        }
        await lock.unlock();
    }
}

let secretsServiceInstance;
const getSecretsServiceInstanceAsync = async (serverRootFolder) => {
    if (!secretsServiceInstance) {
        secretsServiceInstance = new SecretsService(serverRootFolder);
        await secretsServiceInstance.loadAsync();
    }

    secretsServiceInstance.constants = require("./constants");
    return secretsServiceInstance;
}

const resetInstance = async (serverRootFolder) => {
    secretsServiceInstance = new SecretsService(serverRootFolder);
    await secretsServiceInstance.loadAsync();
    return secretsServiceInstance;
}

module.exports = {
    getSecretsServiceInstanceAsync,
    resetInstance
};
