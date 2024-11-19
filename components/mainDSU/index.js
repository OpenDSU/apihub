function MainDSU(server) {
    const {init, handleSetSSIForMainDSUCookie, handleDefaultMainDSURequest} = require("./controller");
    const {requestBodyJSONMiddleware} = require("../../http-wrapper/utils/middlewares");

    init(server);

    server.put("/setSSIForMainDSUCookie", requestBodyJSONMiddleware);
    server.put("/setSSIForMainDSUCookie", handleSetSSIForMainDSUCookie);

    // for mobile app, when it includes the expanded DSU content instead of the actual DSU;
    // this will return a static DSU in order to set it as a main context
    server.use("/getSSIForMainDSU", handleDefaultMainDSURequest);
}

module.exports = MainDSU;
