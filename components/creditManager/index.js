function CreditManager(server){
    const bodyReader = require("../../http-wrapper/utils/middlewares/index").bodyReaderMiddleware;
    const config = require("../../http-wrapper/config");
    const componentsConfig = config.getConfig("componentsConfig")
    const creditManagerConfig = componentsConfig.creditManager;
    const corePath = creditManagerConfig.corePath;
    const CreditManagerCore = require("credit-manager-core");
    const core = new CreditManagerCore(corePath);

    server.use("/credit-manager/*", bodyReader);

    const executeCommand = (req, res) => {
        const command = req.body;
        if(core.allowCommand(command.asUser) === false){
            res.statusCode = 401;
            return res.end(`User ${command.asUser} is not allowed to execute commands`);
        }

        core[command.commandName](...command.args, (err, result) => {
            if(err){
                res.statusCode = 500;
                return res.end(err.message);
            }
            res.statusCode = 200;
            res.end(result);
        });
    }
    server.put("/credit-manager/executeCommand", executeCommand);
}

module.exports = CreditManager;