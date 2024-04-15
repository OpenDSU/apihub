require("../../../../builds/output/testsRuntime");
const tir = require("../../../../psknode/tests/util/tir");
const dc = require("double-check");
const assert = dc.assert;
const openDSU = require("opendsu");
const crypto = openDSU.loadAPI("crypto");
const API_KEY_PATH = "/apiKey";
const USERS = {
    USER1: "user1",
    USER2: "user2"
}

const generateEncryptionKey = () => {
    return crypto.generateRandom(32).toString("base64");
}

assert.callback("Test API keys", async (callback) => {
    const folder = await $$.promisify(dc.createTestFolder)('encrypt secrets');
    let base64EncryptionKey = generateEncryptionKey();
    // set env variable
    process.env.SSO_SECRETS_ENCRYPTION_KEY = base64EncryptionKey;
    const {port} = await tir.launchConfigurableApiHubTestNodeAsync({
        rootFolder: folder
    });
    const url = `http://localhost:${port}`;

    //=================================================================================================
    //=                                  Test API key generation                                      =
    //=================================================================================================
    let generatedAPIKey;
    let firstAdminAPIKey;
    let response;
    let error;
    try {
        response = await fetch(`${url}${API_KEY_PATH}/${USERS.USER1}/true`, {
            method: "POST"
        })
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Failed to generate API key");
    assert.true(response.status === 200, "Generate API key failed");
    error = undefined;
    try {
        generatedAPIKey = await response.text();
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Failed to get API key");
    assert.true(Buffer.from(generatedAPIKey, "base64").length === 32, "API key is not 32 bytes");

    firstAdminAPIKey = generatedAPIKey;
    response = undefined;
    try {
        response = await fetch(`${url}${API_KEY_PATH}/${USERS.USER2}/true`, {
            method: "POST"
        })
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Failed to generate API key");
    assert.true(response.status === 403, "Generate API key should have failed because the sender does not have admin rights");

    response = undefined;
    try {
        response = await fetch(`${url}${API_KEY_PATH}/${USERS.USER2}/true`, {
            method: "POST",
            headers: {
                "Authorization": firstAdminAPIKey
            }
        })
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Failed to generate API key");
    assert.true(response.status === 200, "Generate API key failed");

    error = undefined;
    generatedAPIKey = undefined;
    try {
        generatedAPIKey = await response.text();
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Failed to get API key");
    assert.true(Buffer.from(generatedAPIKey, "base64").length === 32, "API key is not 32 bytes");


    //=================================================================================================
    //=                                  Test API key deletion                                        =
    //=================================================================================================
    response = undefined;
    try {
        response = await fetch(`${url}${API_KEY_PATH}/${USERS.USER2}`, {
            method: "DELETE",
            headers: {
                "Authorization": "first"
            }
        })
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Failed to delete API key");
    assert.true(response.status === 403, "Delete API key should have failed because the sender does not have admin rights");

    response = undefined;
    try {
        response = await fetch(`${url}${API_KEY_PATH}/${USERS.USER2}`, {
            method: "DELETE"
        })
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Failed to delete API key");
    assert.true(response.status === 403, "Delete API key should have failed because the sender does not have admin rights");

    response = undefined;
    try {
        response = await fetch(`${url}${API_KEY_PATH}/${USERS.USER2}`, {
            method: "DELETE",
            headers: {
                "Authorization": firstAdminAPIKey
            }
        })
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Failed to delete API key");
    assert.true(response.status === 200, "Delete API key failed");
    callback();
}, 5000000);

