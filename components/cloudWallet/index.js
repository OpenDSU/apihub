function Iframe(server) {
    const {
        init,
        setRequestKeySSIFromSSAppToken,
        handleSetSSAppTokenRequest,
        handleCloudWalletRequest,
    } = require("./controller");
    const {requestBodyJSONMiddleware} = require("../../utils/middlewares");

    init(server);

    server.put(`/cloud-wallet/setSSAPPToken/:walletAnchorId`, requestBodyJSONMiddleware);
    server.put(`/cloud-wallet/setSSAPPToken/:walletAnchorId`, handleSetSSAppTokenRequest);

    server.use(`/cloud-wallet/:keySSI/*`, setRequestKeySSIFromSSAppToken);
    server.use(`/cloud-wallet/:keySSI/*`, handleCloudWalletRequest);
    server.use(`/:walletName/loader/cloud-wallet/:keySSI/*`, setRequestKeySSIFromSSAppToken);
    server.use(`/:walletName/loader/cloud-wallet/:keySSI/*`, handleCloudWalletRequest);

    // keep old URl style
    server.put(`/iframe/setSSAPPToken/:walletAnchorId`, requestBodyJSONMiddleware);
    server.put(`/iframe/setSSAPPToken/:walletAnchorId`, handleSetSSAppTokenRequest);

    server.use(`/iframe/:keySSI/*`, setRequestKeySSIFromSSAppToken);
    server.use(`/iframe/:keySSI/*`, handleCloudWalletRequest);
    server.use(`/:walletName/loader/iframe/:keySSI/*`, setRequestKeySSIFromSSAppToken);
    server.use(`/:walletName/loader/iframe/:keySSI/*`, handleCloudWalletRequest);
}

module.exports = Iframe;
