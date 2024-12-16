require("../../../../builds/output/testsRuntime");
const {launchApiHubTestNode} = require("../../../../psknode/tests/util/tir");
const dc = require("double-check");
const {assert} = dc;
const path = require("path");
const fs = require("fs");

const logger = $$.getLogger("MainDSUTest", "apihub/MainDSUTest");

const MAIN_DSU_COOKIE_NAME = "MAIN-DSU-VALUE";

const opendsu = require("opendsu");
const http = opendsu.loadApi("http");
const doPut = $$.promisify(http.doPut);

const COOKIE_FIRST_VALUE = "first-value";
const COOKIE_SECOND_VALUE = "second-value";

async function getMainDSU(apiHubUrl, mainDSUCookie) {
    const getMainDSUUrl = `${apiHubUrl}/getSSIForMainDSU`;
    const options = mainDSUCookie
        ? {
            headers: {
                cookie: `${MAIN_DSU_COOKIE_NAME}=${mainDSUCookie}`,
            },
        }
        : undefined;

    const getMainDSUUrlResponse = await http.fetch(getMainDSUUrl, options);
    if (!getMainDSUUrlResponse.ok) {
        throw new Error("GET /getSSIForMainDSU error");
    }
    const mainDSU = await getMainDSUUrlResponse.text();
    logger.info(`Received MainDSU (${mainDSUCookie ? `with cookie: ${mainDSUCookie}` : "without cookie"}): ${mainDSU}`);
    return mainDSU;
}

async function setMainDSUCookieValue(apiHubUrl, value) {
    const mainDSUCookie = await new Promise(async (resolve, reject) => {
        doPut(
            `${apiHubUrl}/setSSIForMainDSUCookie`,
            JSON.stringify({
                value,
            }),
            (error, data, headers) => {
                if (error) {
                    return reject(error);
                }
                resolve(headers["set-cookie"]);
            }
        );
    });
    logger.info("Received Main DSU cookie", mainDSUCookie);
    return mainDSUCookie;
}

assert.callback(
    "Request Main DSU and ensure different DSUs based on sent cookie value test",
    async (testFinished) => {
        try {
            const testFolder = await $$.promisify(dc.createTestFolder)("createWalletTest");
            const port = await $$.promisify(launchApiHubTestNode)(10, testFolder);

            // environment.js is required in order to create the MainDSU
            const environmentJsPath = path.join(testFolder, "environment.js");
            const environmentJsContent = `module.exports = {
                appName: "Test",
                vault: "server",
                agent: "browser",
                system: "any",
                browser: "any",
                mode: "autologin",
                vaultDomain: "vault",
                didDomain: "vault",
                enclaveType: "WalletDBEnclave",
                sw: false,
                pwa: false,
                allowPinLogin: false,
            };`;
            logger.info(`Writing environment.js file to ${environmentJsPath}`);
            fs.writeFileSync(environmentJsPath, environmentJsContent);

            try {
                const env = require(environmentJsPath);
                logger.info("Loaded env: ", JSON.stringify(env));
            } catch (error) {
                logger.error("FAILED TO LOAD", error);
            }

            const apiHubUrl = `http://localhost:${port}`;

            const defaultMainDSU = await getMainDSU(apiHubUrl);

            // set cookie value and reload MainDSU
            const firstCookie = await setMainDSUCookieValue(apiHubUrl, COOKIE_FIRST_VALUE);
            const firstCookieMainDSU = await getMainDSU(apiHubUrl, firstCookie);

            assert.notEqual(defaultMainDSU, firstCookieMainDSU);

            // set another cookie value and reload MainDSU
            const secondCookie = await setMainDSUCookieValue(apiHubUrl, COOKIE_SECOND_VALUE);
            const secondCookieMainDSU = await getMainDSU(apiHubUrl, secondCookie);

            assert.notEqual(secondCookieMainDSU, defaultMainDSU);
            assert.notEqual(secondCookieMainDSU, firstCookieMainDSU);

            // reload all MainDSU's based on cookie value
            const reloadedDefaultMainDSU = await getMainDSU(apiHubUrl);
            assert.equal(defaultMainDSU, reloadedDefaultMainDSU);

            const reloadedFirstCookieMainDSU = await getMainDSU(apiHubUrl, firstCookie);
            assert.equal(firstCookieMainDSU, reloadedFirstCookieMainDSU);

            const reloadedSecondCookieMainDSU = await getMainDSU(apiHubUrl, secondCookie);
            assert.equal(secondCookieMainDSU, reloadedSecondCookieMainDSU);

            testFinished();
        } catch (error) {
            logger.error(error);
            throw error;
        }
    },
    60000
);
