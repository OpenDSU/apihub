module.exports = function (server) {
    const Lock = require("./Lock");
    const lock = new Lock(server.rootFolder);
    const {putLock, removeLock} = lock;

    server.get("/lock", (req, res) => {
        let {id, secret, period} = req.query;
        if (!id || !secret || !period) {
            res.statusCode = 400;
            res.end();
            return;
        }

        putLock(id, secret, period, (err, success) => {
            if (err) {
                res.statusCode = 500;
                res.end();
                return;
            }
            if (success) {
                res.statusCode = 200;
                res.end();
                return;
            }
            res.statusCode = 409;
            res.end();
        });
    });

    server.get("/unlock", (req, res) => {
        let {id, secret} = req.query;
        if (!id || !secret) {
            res.statusCode = 400;
            res.end();
            return;
        }
        removeLock(id, secret, (err, result) => {
            if (err) {
                res.statusCode = 500;
                res.end();
                return;
            }
            if (result) {
                res.statusCode = 200;
                res.end();
                return;
            }
            res.statusCode = 404;
            res.end();
        });
    });
}
