function Loader(serverUrl, configFilePath) {
    const fsPromises = require("fs").promises;

    const registerPlugin = async (pluginName, pluginPath) => {
        await fetch(serverUrl + "/registerPlugin", {
            method: "PUT",
            body: JSON.stringify({pluginPath, pluginName})
        });
    }

    this.load = async () => {
        let config = await fsPromises.readFile(configFilePath, "utf-8");
        config = JSON.parse(config);
        for (let plugin in config) {
            await registerPlugin(plugin, config[plugin].path);
        }
    }
}

module.exports = Loader;