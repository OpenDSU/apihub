require("../../../../builds/output/testsRuntime");
const {launchApiHubTestNode} = require("../../../../psknode/tests/util/tir");
const dc = require("double-check");
const {assert} = dc;

const logger = $$.getLogger("CloudWalletTest", "apihub/cloud-wallet");

const DOMAIN = "default";
const TEXT_FILE_PATH = "/code/test.txt";
const TEXT_URL_FILE_PATH = "test.txt";
const TEXT_FILE_CONTENT = "dummy text content";
const SSAPP_TOKEN_COOKIE_NAME = "SSAPP-TOKEN";

const opendsu = require("opendsu");
const resolver = opendsu.loadApi("resolver");
const keySSIApi = opendsu.loadApi("keyssi");
const http = opendsu.loadApi("http");
const doPut = $$.promisify(http.doPut);

assert.callback(
    "Request DSU file content using walletAnchorId in URL instead of sReasSSI",
    async (testFinished) => {
        try {
            const testFolder = await $$.promisify(dc.createTestFolder)("createWalletTest");
            const port = await $$.promisify(launchApiHubTestNode)(10, testFolder);
            const apiHubUrl = `http://localhost:${port}`;

            const templateSeedSSI = keySSIApi.createTemplateSeedSSI(DOMAIN);
            const dsu = await $$.promisify(resolver.createDSU)(templateSeedSSI);

            const dsuKeySSI = await $$.promisify(dsu.getKeySSIAsObject)();
            const dsuSReadKeySSI = await $$.promisify(dsuKeySSI.derive)();
            const dsuSReadKeySSIText = dsuSReadKeySSI.getIdentifier();

            // write file to DSU
            await $$.promisify(dsu.writeFile)(TEXT_FILE_PATH, TEXT_FILE_CONTENT);
            const textFileContent = await $$.promisify(dsu.readFile)(TEXT_FILE_PATH);
            assert.equal(textFileContent.toString(), TEXT_FILE_CONTENT);

            // load DSU using sReadSSI to ensure access to newly created file
            const loadedDsu = await $$.promisify(resolver.loadDSU)(dsuSReadKeySSIText);
            const loadedTextFileContent = await $$.promisify(loadedDsu.readFile)(TEXT_FILE_PATH);
            assert.equal(loadedTextFileContent.toString(), TEXT_FILE_CONTENT);

            // load file from DSU using cloud-wallet and sReadSSI
            const cloudWalletFileUrl = `${apiHubUrl}/cloud-wallet/${dsuSReadKeySSIText}/${TEXT_URL_FILE_PATH}`;
            const cloudWalletFileResponse = await http.fetch(cloudWalletFileUrl);
            if (!cloudWalletFileResponse.ok) {
                throw new Error("PUT error");
            }
            const cloudWalletFileResponseText = await cloudWalletFileResponse.text();
            assert.equal(cloudWalletFileResponseText, TEXT_FILE_CONTENT);

            // set setSSAPPToken
            const walletAnchorId = await $$.promisify(dsuKeySSI.getAnchorId)();
            const tokenResponseCookie = await new Promise(async (resolve, reject) => {
                doPut(
                    `${apiHubUrl}/cloud-wallet/setSSAPPToken/${walletAnchorId}`,
                    JSON.stringify({
                        sReadSSI: dsuSReadKeySSIText,
                    }),
                    (error, data, headers) => {
                        if (error) {
                            return reject(error);
                        }
                        resolve(headers["set-cookie"]);
                    }
                );
            });
            logger.info("Received token cookie", tokenResponseCookie);

            // load file from DSU using cloud-wallet and walletAnchorId but without setting the token header
            const cloudWalletWalletWithoutCookieFileUrl = `${apiHubUrl}/cloud-wallet/${walletAnchorId}/${TEXT_URL_FILE_PATH}`;
            const cloudWalletWalletWithoutCookieFileResponse = await http.fetch(cloudWalletWalletWithoutCookieFileUrl);
            if (cloudWalletWalletWithoutCookieFileResponse.ok) {
                throw new Error("cloud-wallet without cookie header should fail");
            }

            // load file from DSU using cloud-wallet and walletAnchorId but without setting the token header
            const cloudWalletWalletWithInvalidCookieFileUrl = `${apiHubUrl}/cloud-wallet/${walletAnchorId}/${TEXT_URL_FILE_PATH}`;
            const cloudWalletWalletWithInvalidCookieFileResponse = await http.fetch(cloudWalletWalletWithInvalidCookieFileUrl, {
                headers: {
                    cookie: `${SSAPP_TOKEN_COOKIE_NAME}=invalid-value-provided`,
                },
            });
            if (cloudWalletWalletWithInvalidCookieFileResponse.ok) {
                throw new Error("cloud-wallet with invalid cookie header should fail");
            }

            // load file from DSU using cloud-wallet and walletAnchorId with setting the correct token header
            const cloudWalletWalletFileUrl = `${apiHubUrl}/cloud-wallet/${walletAnchorId}/${TEXT_URL_FILE_PATH}`;
            const cloudWalletWalletFileResponse = await http.fetch(cloudWalletWalletFileUrl, {
                headers: {
                    cookie: tokenResponseCookie,
                },
            });
            if (!cloudWalletWalletFileResponse.ok) {
                throw new Error("PUT error");
            }
            const cloudWalletWalletFileResponseText = await cloudWalletWalletFileResponse.text();
            assert.equal(cloudWalletWalletFileResponseText, TEXT_FILE_CONTENT);

            testFinished();
        } catch (error) {
            logger.error(error);
            throw error;
        }
    },
    60000
);
