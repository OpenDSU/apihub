require("../../../../builds/output/testsRuntime");
const dc = require("double-check");
const assert = dc.assert;
const openDSU = require("opendsu");
const crypto = openDSU.loadAPI("crypto");
const generateEncryptionKey = () => {
    return crypto.generateRandom(32).toString("base64");
}

assert.callback('check if secrets endpoint encryption and key rotation work', async (callback) => {
    const folder = await $$.promisify(dc.createTestFolder)('encrypt secrets');
    let base64EncryptionKey = generateEncryptionKey();
    // set env variable
    process.env.SSO_SECRETS_ENCRYPTION_KEY = base64EncryptionKey;
    const SecretsService = require("../../components/secrets/SecretsService");
    const ss1 = await SecretsService.getSecretsServiceInstanceAsync(folder);
    await ss1.putSecretAsync("sc", "user1", "secret1");
    const ss2 = await SecretsService.getSecretsServiceInstanceAsync(folder);
    const receivedSecret = await ss2.getSecretSync("sc", "user1");
    assert.true(receivedSecret === "secret1", "Secrets are not the same");

    await ss1.putSecretAsync("sc", "user2", "secret2");
    await ss2.putSecretAsync("sc", "user3", "secret3");
    await ss2.deleteSecretAsync("sc", "user1");
    await ss1.putSecretAsync("sc", "user4", "secret4");

    await ss1.putSecretAsync("sc1", "secretName1", "secret1");
    const sc3 = ss1.getSecretSync("sc", "user3");
    assert.true(sc3 === "secret3", "Secrets are not the same");

    try {
        await ss1.getSecretSync("sc", "user1");
    } catch (e) {
        process.env.SSO_SECRETS_ENCRYPTION_KEY = `${generateEncryptionKey()},${process.env.SSO_SECRETS_ENCRYPTION_KEY}`;
        const ss4 = await SecretsService.resetInstance(folder);
        const sc3 = ss4.getSecretSync("sc", "user3");
        const sc4 = ss4.getSecretSync("sc1", "secretName1");
        assert.true(sc3 === "secret3", "Secrets are not the same");
        assert.true(sc4 === "secret1", "Secrets are not the same");
        callback()
    }

}, 5000000);
