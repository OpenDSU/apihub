require("../../../../builds/output/openDSU");
openDSURequire('overwrite-require');
const logger = $$.getLogger("tenantCustomization", "apihub/admin");

const opendsu = openDSURequire("opendsu");
const http = opendsu.loadApi("http");

const BASE_URL = process.env.BASE_URL || "https://admin.pla.health";
const dnsDomain = process.env.DNS_DOMAIN || "pla.health";

const MAIN_DOMAIN = process.env.MAIN_DOMAIN || "demo.epi";
const SUB_DOMAIN_BASE = process.env.SUB_DOMAIN || "demo.epi";
const VAULT_NAME_BASE = process.env.VAULT_DOMAIN || "demo.vault";

const cloneMainDomain = process.env.CLONE_MAIN_DOMAIN || "demo.epi";
const cloneVaultDomain = process.env.CLONE_VAULT_DOMAIN || "demo.vault.pla";

const ADMIN_DNS_DOMAIN = process.env.ADMIN_DNS_DOMAIN ? "" : undefined;

const LEAFLET_ENV_TEMPLATE = process.env.LEAFLET_ENV_TEMPLATE || 'export default { "appName": "eLeaflet", "vault": "server", "agent": "browser", "system": "any", "browser": "any", "mode": "autologin", "vaultDomain": "${vaultDomain}", "didDomain": "${didDomain}", "enclaveType": "WalletDBEnclave", "sw": false, "pwa": false, "allowPinLogin": false, "lockFeatures": false, "disabledFeatures": "", "epiProtocolVersion": 1}'
const DSU_ENV_TEMPLATE = process.env.LEAFLET_ENV_TEMPLATE || 'export default { "appName": "DSU_Fabric", "vault": "server", "agent": "browser", "system": "any", "browser": "any", "mode": "dev-secure", "vaultDomain": "${vaultDomain}", "didDomain": "${didDomain}", "epiDomain": "${mainDomain}", "epiSubdomain": "${subDomain}", "enclaveType": "WalletDBEnclave", "sw": false, "pwa": false, "allowPinLogin": false, "companyName": "${companyName}", "disabledFeatures": "", "lockFeatures": false, "epiProtocolVersion": 1}';
const DEMIURGE_ENV_TEMPLATE = process.env.LEAFLET_ENV_TEMPLATE || 'export default { "appName": "Demiurge", "vault": "server", "agent": "browser", "system": "any", "browser": "any", "mode": "dev-secure", "vaultDomain": "${vaultDomain}", "didDomain": "${didDomain}", "enclaveType":"WalletDBEnclave", "companyName": "${companyName}", "sw": false, "pwa": false}';

const templates = {
    "/demiurge-wallet/loader/environment.js": DEMIURGE_ENV_TEMPLATE,
    "/dsu-fabric-wallet/loader/environment.js": DSU_ENV_TEMPLATE,
    "/leaflet-wallet/loader/environment.js": LEAFLET_ENV_TEMPLATE
};

const TENANT_NAME = process.env.TENANT_NAME || "nvs";
const companies = [TENANT_NAME];
const SUBDOMAIN_COMMON_PREFIX = process.env.SUBDOMAIN_COMMON_PREFIX || "";

function getCompanyDNSDomain(name) {
    return SUBDOMAIN_COMMON_PREFIX + name + "." + dnsDomain;
}

function getCompanySubDomain(name) {
    return SUB_DOMAIN_BASE + "." + name;
}

function getCompanyVaultDomain(name) {
    return VAULT_NAME_BASE + "." + name;
}

function getCompanyVars(companyName) {
    return {
        companyName: companyName,
        mainDomain: MAIN_DOMAIN,
        subDomain: getCompanySubDomain(companyName),
        didDomain: getCompanyVaultDomain(companyName),
        vaultDomain: getCompanyVaultDomain(companyName),
    };
}

async function storeVariable(dns, prop, value) {
    try {
        let doPost = $$.promisify(http.doPost);
        await doPost(`${BASE_URL}/admin/${MAIN_DOMAIN}/storeVariable`, JSON.stringify({
            "dnsDomain": dns,
            "variableName": prop,
            "variableContent": value
        }));
        logger.debug(`Finished storing variable ${prop}=${value} for ${dns}`);
    } catch (e) {
        console.trace(e);
        process.exit(1);
    }
}

async function createDomain(domainName, cloneFrom) {
    try {
        let doPost = $$.promisify(http.doPost);
        await doPost(`${BASE_URL}/admin/${MAIN_DOMAIN}/addDomain`, JSON.stringify({
            "domainName": domainName,
            "cloneFromDomain": cloneFrom
        }));
        logger.debug(`Finished createDomain ${domainName} based on ${cloneFrom}`);
    } catch (e) {
        console.trace(e);
        process.exit(1);
    }
}

async function registerTemplate(path, content) {
    try {
        let doPost = $$.promisify(http.doPost);
        await doPost(`${BASE_URL}/admin/${MAIN_DOMAIN}/registerTemplate`, JSON.stringify({
            path,
            content
        }));
        logger.debug(`Finished registering template for path ${path}`);
    } catch (e) {
        console.trace(e);
        process.exit(1);
    }
}

(async () => {

    for (let path in templates) {
        let content = templates[path];
        await registerTemplate(path, content);
    }

    let companyVars = {
        companyName: "PLA",
        mainDomain: MAIN_DOMAIN,
        subDomain: MAIN_DOMAIN,
        didDomain: cloneVaultDomain,
        vaultDomain: cloneVaultDomain,
    };

    if (ADMIN_DNS_DOMAIN) {
        for (let prop in companyVars) {
            await storeVariable(ADMIN_DNS_DOMAIN, prop, companyVars[prop]);
        }
    }

    for (let i = 0; i < companies.length; i++) {
        let companyName = companies[i];

        await createDomain(getCompanySubDomain(companyName), cloneMainDomain);
        await createDomain(getCompanyVaultDomain(companyName), cloneVaultDomain);

        let companyDNS = getCompanyDNSDomain(companyName);
        let companyVars = getCompanyVars(companyName);
        for (let prop in companyVars) {
            await storeVariable(companyDNS, prop, companyVars[prop]);
        }
    }
})();
