let path = "path";
path = require(path);
let fs = "fs";
fs = require(fs);

let readOnly = false;

function ReadOnlyMiddleware(server, registerHandler = true) {
    let config = server.config;
    let readOnlyFlag = config.readOnlyFile || "readonly";
    let interval = config.readOnlyInterval || 60 * 1000;
    let rootStorage = path.resolve(config.storage);
    readOnlyFlag = path.resolve(rootStorage, readOnlyFlag);

    if (readOnlyFlag.indexOf(rootStorage) === -1) {
        console.warn(`ReadOnly flag location resolved outside of ApiHUB root folder. (${readOnlyFlag})`);
    }

    Object.defineProperty(server, "readOnlyModeActive", {
        get: function () {
            return readOnly;
        }
    });

    function enableReadOnly() {
        if (!readOnly) {
            console.info("Read only mode is activated.");
            readOnly = true;
        }
    }

    function disableReadOnly() {
        if (readOnly) {
            console.info("Read only mode is disabled.");
            readOnly = false;
        }
    }

    function checkReadOnlyFlag() {
        let envFlag = process.env.READ_ONLY_MODE;
        if (typeof envFlag === "string" && envFlag.toLowerCase().trim() === "true") {
            console.info("READ_ONLY_MODE env flag was detected.");
            enableReadOnly();
            return;
        }
        fs.access(readOnlyFlag, fs.constants.F_OK, (err) => {
            if (!err) {
                enableReadOnly();
            } else {
                disableReadOnly();
            }
        });
    }

    checkReadOnlyFlag();
    setInterval(checkReadOnlyFlag, interval);

    if (registerHandler) {
        server.use("*", function (req, res, next) {
            if (readOnly && req.method !== "GET" && req.method !== "HEAD") {
                res.statusCode = 405;
                res.write("read only mode is active");
                return res.end();
            }
            next();
        });
    }
}

module.exports = ReadOnlyMiddleware;