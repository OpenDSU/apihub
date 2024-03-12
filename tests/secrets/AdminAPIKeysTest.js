require("../../../../builds/output/testsRuntime");
const tir = require("../../../../psknode/tests/util/tir");
const dc = require("double-check");
const assert = dc.assert;
const path = require("path");
const fs = require("fs");
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
    const serverConfig = {
        "storage": folder,
        "preventRateLimit": true,
        "activeComponents": [
            "bdns",
            "bricking",
            "anchoring",
            "mq",
            "secrets",
            "lightDBEnclave",
            "staticServer"
        ],
        "componentsConfig": {
            "staticServer": {
                "excludedFiles": [
                    ".*.secret"
                ]
            },
            "bricking": {},
            "anchoring": {}
        },
        "enableSimpleAuth": true
    }
    const openDSU = require("opendsu");
    const crypto = openDSU.loadAPI("crypto");

    const htPasswordPath = path.join(folder, ".htpassword.secret");
    for(let i=0; i<10; i++){
        const user = `user${i}`;
        const password = `password${i}`;
        const hashedPassword = crypto.sha256JOSE(password).toString("hex");
        const mail = `usr${i}@example.com`;
        const ssoId = `usr${i}@example.com`;
        fs.appendFileSync(htPasswordPath, `${user}:${hashedPassword}:${mail}:${ssoId}\n`);
    }
    const {port} = await tir.launchConfigurableApiHubTestNodeAsync({
        rootFolder: folder,
        serverConfig: serverConfig
    });
    const url = `http://localhost:${port}`;
    const Client = require("../../../../modules/apihub/components/secrets/APIKeysClient");
    const client = new Client(url);
    const apiKey = generateEncryptionKey();
    const authorization = `user1:${crypto.sha256JOSE("password1").toString("hex")}`
    await client.becomeSysAdmin(apiKey, authorization);
    await client.makeSysAdmin("usr2@example.com", generateEncryptionKey(), authorization);
    let newAPIKey = generateEncryptionKey();
    await client.associateAPIKey("appName", "name", "usr3@example.com", newAPIKey, authorization);
    const receivedAPIKey = await client.getAPIKey("appName", "name", "usr3@example.com", authorization);
    assert.true(receivedAPIKey === newAPIKey, "Invalid API");

    callback();
}, 5000000);

