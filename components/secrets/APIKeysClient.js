function APIKeysClient(baseUrl) {
    const openDSU = require("opendsu");
    const systemAPI = openDSU.loadAPI("system");
    const BASE_URL = baseUrl || systemAPI.getBaseURL();

    const _sendRequest = async (endpoint, method, data, accessToken) => {
        if (typeof data === "object") {
            data = JSON.stringify(data);
        }

        let headers = {};
        if (accessToken) {
            headers["Authorization"] = `Bearer ${accessToken}`;
        }

        const options = {
            method,
            headers,
            body: data
        }

        if (method === "GET" || method === "DELETE") {
            delete options.body;
        }

        const response = await fetch(`${BASE_URL}${endpoint}`, options);
        if(!response.ok){
            throw new Error(`Failed to fetch ${endpoint} with status ${response.status}`);
        }
        return response.text();
    }

    this.becomeSysAdmin = async (apiKey, accessToken) => {
        return await _sendRequest(`/becomeSysAdmin`, "PUT", apiKey, accessToken);
    }

    this.makeSysAdmin = async (userId, apiKey, accessToken) => {
        return await _sendRequest(`/makeSysAdmin/${encodeURIComponent(userId)}`, "PUT", apiKey, accessToken);
    }

    this.deleteAdmin = async (userId, accessToken) => {
        return await _sendRequest(`/deleteAdmin/${encodeURIComponent(userId)}`, "DELETE", undefined, accessToken);
    }

    this.associateAPIKey = async (appName, name, userId, apiKey, accessToken) => {
        return await _sendRequest(`/associateAPIKey/${encodeURIComponent(appName)}/${encodeURIComponent(name)}/${encodeURIComponent(userId)}`, "PUT", apiKey, accessToken);
    }

    this.deleteAPIKey = async (appName, name, userId, accessToken) => {
        return await _sendRequest(`/deleteAPIKey/${encodeURIComponent(appName)}/${encodeURIComponent(name)}/${encodeURIComponent(userId)}`, "DELETE", undefined, accessToken);
    }

    this.getAPIKey = async (appName, name, userId, accessToken) => {
        return await _sendRequest(`/getAPIKey/${encodeURIComponent(appName)}/${encodeURIComponent(name)}/${encodeURIComponent(userId)}`, "GET", undefined, accessToken);
    }
}

module.exports = APIKeysClient;