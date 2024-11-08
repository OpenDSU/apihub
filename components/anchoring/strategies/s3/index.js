function S3(server, domainConfig, anchorId, anchorValue, jsonData) {
    let domain = domainConfig.name;
    const getUrl = (action) => {
        let url = domainConfig.option.endpoint;
        url = `${url}/${action}`;
        if (domain) {
            url = `${url}/${domain}`;
        }
        if (anchorId) {
            url = `${url}/${anchorId}`;
        }
        if (anchorValue) {
            url = `${url}/${anchorValue}`;
        }
        return url;
    };

    const writeToServer = (action, callback) => {
        const endpoint = getUrl(action);
        let options = {
            method: 'PUT',
            headers: {}
        };

        if (jsonData) {
            const bodyData = JSON.stringify(jsonData);
            options.headers['Content-Type'] = 'application/json';
            options.body = bodyData;
        }

        fetch(endpoint, options)
            .then(response => response.json())
            .then(data => callback(undefined, data))
            .catch(error => {
                console.error("Error:", error);
                callback(error);
            });
    };

    const readFromServer = (action, domain, anchorId, callback, asJson = true) => {
        const endpoint = getUrl(action);

        fetch(endpoint)
            .then(response => asJson ? response.json() : response.text())
            .then(data => callback(undefined, data))
            .catch(error => {
                console.error("Error:", error);
                callback(error);
            });
    };

    this.createAnchor = (callback) => {
        writeToServer("create-anchor", domain, anchorId, anchorValue, undefined, callback);
    };

    this.appendAnchor = (callback) => {
        writeToServer("append-to-anchor", domain, anchorId, anchorValue, undefined, callback);
    };

    this.getAllVersions = (callback) => {
        readFromServer("get-all-versions", domain, anchorId, callback, true);
    };

    this.getLastVersion = (callback) => {
        readFromServer("get-last-version", domain, anchorId, callback, false);
    };
}

module.exports = S3;