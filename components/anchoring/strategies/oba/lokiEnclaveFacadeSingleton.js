const fs = require("fs");
const path = require("path");

const getLokiEnclaveFacade = (storageFile) => {
    if (typeof $$.lokiEnclaveFacade === "undefined") {
        try {
            fs.accessSync(path.dirname(storageFile));
        } catch (e) {
            fs.mkdirSync(path.dirname(storageFile), {recursive: true});
        }
        const lokiEnclaveFacadeModule = require("loki-enclave-facade");
        const createLokiEnclaveFacadeInstance = lokiEnclaveFacadeModule.createLokiEnclaveFacadeInstance;
        $$.lokiEnclaveFacade = createLokiEnclaveFacadeInstance(storageFile);
    }

    return $$.lokiEnclaveFacade;
}

module.exports = {
    getLokiEnclaveFacade
}
