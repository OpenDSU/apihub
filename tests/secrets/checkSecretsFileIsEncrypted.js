require("../../../../builds/output/testsRuntime");
const tir = require("../../../../psknode/tests/util/tir");
const dc = require("double-check");
const assert = dc.assert;
const path = require("path");
const fs = require("fs");
const config = require("../../http-wrapper/config");
const openDSU = require("opendsu");
const crypto = openDSU.loadAPI("crypto");
const PUT_SECRETS_URL_PATH = "/putSSOSecret/Demiurge";
const GET_SECRETS_URL_PATH = "/getSSOSecret/Demiurge";
const USER_ID = "someUser";
const secret = "some secret";
const generateEncryptionKey = () => {
    return crypto.generateRandom(32).toString("base64");
}

assert.callback('check if secrets endpoint encryption and key rotation work', async (callback) => {
    const folder = await $$.promisify(dc.createTestFolder)('encrypt secrets');
    let base64EncryptionKey = generateEncryptionKey();
    // set env variable
    process.env.SSO_SECRETS_ENCRYPTION_KEY = base64EncryptionKey;
    const {port} = await tir.launchConfigurableApiHubTestNodeAsync({
        rootFolder: folder
    });
    const url = `http://localhost:${port}`;
    const httpAPI = openDSU.loadAPI("http");
    //send a secret to the secrets endpoint for storage; secret should be encrypted with process.env.SSO_SECRETS_ENCRYPTION_KEY and stored on disk
    await $$.promisify(httpAPI.doPut)(`${url}${PUT_SECRETS_URL_PATH}`, {secret}, {headers: {"user-id": USER_ID}});
    const secretsFolderPath = path.join(folder, config.getConfig("externalStorage"), "secrets");
    const demiurgeSecretsFilePath = path.join(secretsFolderPath, "Demiurge.secret");

    // read encrypted data from disk
    let encryptedSecret = fs.readFileSync(demiurgeSecretsFilePath);
    let decryptedSecret;
    let error;

    // attempt to decrypt data using the correct encryption key
    try {
        decryptedSecret = crypto.decrypt(encryptedSecret, $$.Buffer.from(base64EncryptionKey, "base64"));
    } catch (e) {
        error = e;
    }
    assert.equal(error, undefined, "Decryption failed");
    assert.equal(JSON.parse(decryptedSecret.toString())[USER_ID], secret);

    //generate new encryption key
    let newBase64EncryptionKey = generateEncryptionKey();
    // attempt to decrypt data using wrong encryption key (error expected)
    try {
        decryptedSecret = crypto.decrypt(encryptedSecret, $$.Buffer.from(newBase64EncryptionKey, "base64"));
    } catch (e) {
        error = e;
    }
    assert.notEqual(error, undefined, "Decryption should fail");
    //=================================================================================================================
    //============================================== Rotate key =======================================================
    //=================================================================================================================
    process.env.SSO_SECRETS_ENCRYPTION_KEY = `${newBase64EncryptionKey},${process.env.SSO_SECRETS_ENCRYPTION_KEY}`;
    // read secret from secrets endpoint (expected "{\"secret\": \"some secret\"}" )
    // the get call will trigger the re-encryption of secrets using the new key
    let secretReadFromServer = await $$.promisify(httpAPI.doGet)(`${url}${GET_SECRETS_URL_PATH}`, {headers: {"user-id": USER_ID}});
    await $$.promisify(httpAPI.doPut)(`${url}${PUT_SECRETS_URL_PATH}`, {secret}, {headers: {"user-id": USER_ID}});
    assert.equal(secretReadFromServer, secret);

    // read again the encrypted data from disk
    encryptedSecret = fs.readFileSync(demiurgeSecretsFilePath);
    error = undefined;
    // attempt to decrypt the data using the new key (decryption should succeed)
    try {
        decryptedSecret = crypto.decrypt(encryptedSecret, $$.Buffer.from(newBase64EncryptionKey, "base64"));
    } catch (e) {
        error = e;
    }

    assert.equal(error, undefined, "Decryption failed");
    assert.equal(JSON.parse(decryptedSecret.toString())[USER_ID], secret);
    // attempt to decrypt the data using the old key (error should be thrown)
    try {
         crypto.decrypt(encryptedSecret, $$.Buffer.from(base64EncryptionKey, "base64"));
    } catch (e) {
        error = e;
    }

    assert.notEqual(error, undefined, "Decryption should fail");

    process.env.SSO_SECRETS_ENCRYPTION_KEY = `${newBase64EncryptionKey}`
    secretReadFromServer = await $$.promisify(httpAPI.doGet)(`${url}${GET_SECRETS_URL_PATH}`, {headers: {"user-id": USER_ID}});
    assert.equal(secretReadFromServer, secret);
    callback()
}, 5000000);
