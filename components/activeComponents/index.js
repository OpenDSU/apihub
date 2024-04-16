module.exports = function (server) {

    function getEndpointRow(endpoint) {
        //return endpoint;
        let enabled = true;
        if (["get", "head"].indexOf(endpoint.method) === -1 && server.readOnlyModeActive) {
            enabled = false;
        }
        return `<div class="row">
                    <div class="cell">endpoint</div>
                    <div class="cell">${endpoint.method}</div>
                    <div class="cell">${endpoint.url}</div>
                    <div class="cell">${enabled}</div>
                </div>`;
    }

    function getMiddlewareRow(endpoint) {
        //return endpoint;
        let enabled = "PUT, POST, DELETE methods are disabled in readOnly";
        return `<div class="row">
                    <div class="cell">middleware</div>
                    <div class="cell">${endpoint.method ? endpoint.method : "ALL"}</div>
                    <div class="cell">${endpoint.url ? endpoint.url : "-"} [${endpoint.fn.name}]</div>
                    <div class="cell">${enabled}</div>
                </div>`;
    }

    function testIfEndpoint(endpoint) {
        return !!endpoint.url && !!endpoint.method;
    }

    function testIfMiddleware(endpoint) {
        return !testIfEndpoint(endpoint) && !!endpoint.fn.name;
    }

    server.get("/listActiveComponents", async function (req, res) {
        let template = require("./template.js");
        let $$HEADER = "";

        let endpoints = server.getRegisteredMiddlewareFunctions();
        let $$ACTIVE_COMPONENTS = '';
        let endpointsCounter = 0;
        let middlewaresCounter = 0;
        for (let endpoint of endpoints) {
            if (testIfEndpoint(endpoint)) {
                endpointsCounter++;
                $$ACTIVE_COMPONENTS += getEndpointRow(endpoint);
            }
            if (testIfMiddleware(endpoint)) {
                middlewaresCounter++;
                $$ACTIVE_COMPONENTS += getMiddlewareRow(endpoint);
            }
        }
        $$HEADER = `
        <div>
        No. middlewares: ${middlewaresCounter}
        <br>
        No. endpoints: ${endpointsCounter}
        </div>
        `;
        template = template.replace("$$HEADER", $$HEADER);
        template = template.replace("$$ACTIVE_COMPONENTS", $$ACTIVE_COMPONENTS);

        res.statusCode = 200;
        res.end(template);
    });
}