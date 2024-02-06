require("../../../../builds/output/testsRuntime");
const tir = require("../../../../psknode/tests/util/tir");
const dc = require("double-check");
const assert = dc.assert;
const path = require("path");
const fs = require("fs");
const config = require("../../config");
const openDSU = require("opendsu");
const crypto = openDSU.loadAPI("crypto");
const GENERATE_API_KEY_PATH = "/apiKey";
const DELETE_API_KEY_PATH = "/apiKey";
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
    let generatedAPIKey = await fetch(`${url}${GENERATE_API_KEY_PATH}/userId/true`, {
        method: "POST",
        headers: {
            "Authorization": "someUser"
        }
    })

    generatedAPIKey = await generatedAPIKey.text();
    assert.true(generatedAPIKey.length > 0, "API Key not generated");
    callback();
}, 5000000);

