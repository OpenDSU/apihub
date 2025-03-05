function Logger(server) {
    const LOG_IDENTIFIER = "Logger";
    const logger = $$.getLogger(LOG_IDENTIFIER, "apihub/logger");
    logger.debug(`Registering Logger middleware`);

    const getRequestDuration = (start) => {
        const diff = process.hrtime(start);
        return (diff[0] * 1e9 + diff[1]) / 1e6;
    };

    let ms = 10000;
    let longRequests = [];
    const config = server.config.componentsConfig;
    if (config.requestLogger) {
        if (config.requestLogger.statusLogInterval) {
            ms = config.requestLogger.statusLogInterval;
            logger.debug(`Requests that will take longer than ${ms} ms will be logged as in progress`);
        }

        if (config.requestLogger.longRequests) {
            if (!Array.isArray(config.requestLogger.longRequests)) {
                logger.error("longRequests config is expected to be an Array of strings! Check config to make it apply!");
            } else {
                longRequests = config.requestLogger.longRequests;
                logger.debug("the following filter will be used to acknowledge longer time resolve urls", JSON.stringify(longRequests));
            }
        }
    }

    server.use(function (req, res, next) {
        const {
            method,
            url
        } = req;

        const start = process.hrtime();

        let timer;
        let quickReq = true;
        for (let longReq of longRequests) {
            if (url.indexOf(longReq) !== -1) {
                quickReq = false;
            }
        }

        if (quickReq) {
            //we don't want to log requests that have a big time to leave like (TLL) in case of http poll requests
            timer = setInterval(() => {
                logger.info(`Request progress ${method}:${url}`);
            }, ms);
        }

        let durationInMilliseconds;

        //let's add a safety net and log
        res.on('error', (error) => {
            if (error) {
                //may be redundant to check the argument but still ...
                logger.info(`Error while sending response for ${method}:${url}`, error.code, error.message);
            }
        });

        req.on("error", (err) => {
            //clearing the timer
            if (timer) {
                clearInterval(timer);
            }
            logger.info(`Request closed by client`, `${method}:${url}`, err ? err.message : "", err);
        });

        res.on('finish', () => {
            //clearing the timer
            if (timer) {
                clearInterval(timer);
            }

            const {statusCode} = res;
            durationInMilliseconds = getRequestDuration(start);
            let log = `${method}:${url} ${statusCode} ${durationInMilliseconds.toLocaleString()}ms`;
            logger.log(log);
            if (req.getLogs) {
                const visualIndex = "\t";
                const requestLogs = req.getLogs();
                if (requestLogs.length > 0) {
                    logger.debug("Request logs:");
                    for (let i = 0; i < requestLogs.length; i++) {
                        if (Array.isArray(requestLogs)) {
                            logger.log(visualIndex, ...requestLogs[i]);
                        } else {
                            logger.log(visualIndex, requestLogs[i]);
                        }
                    }
                    logger.log("\n");
                }
            }
        });

        next();
    });
}

module.exports = Logger;
