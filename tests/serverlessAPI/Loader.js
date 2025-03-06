function Loader(serverUrl, configFilePath) {
    const fsPromises = require("fs").promises;

    const registerPlugin = async (pluginPath, namespace, config) => {
        await fetch(serverUrl + "/registerPlugin", {
            method: "PUT",
            body: JSON.stringify({pluginPath, namespace, config})
        });
    }

    this.load = async () => {
        let config = await fsPromises.readFile(configFilePath, "utf-8");
        config = JSON.parse(config);
        for (let plugin in config) {
            await registerPlugin(config[plugin].path, plugin, config[plugin].config);
        }
    }
}

module.exports = Loader;