const logger = $$.getLogger("HttpServer", "apihub");

process.on('uncaughtException', err => {
    logger.critical('There was an uncaught error', err, err.message, err.stack);
});

process.on('SIGTERM', (signal) => {
    process.shuttingDown = true;
    logger.info('Received signal:', signal, ". Activating the gracefulTerminationWatcher.");
});

const httpWrapper = require('./http-wrapper');
const Server = httpWrapper.Server;

const CHECK_FOR_RESTART_COMMAND_FILE_INTERVAL = 500;

(function loadDefaultComponents() {
    //next require lines are only for browserify build purpose
    // Remove mock
    require('./components/admin');
    require('./components/config');
    require('./components/bricking');
    require('./components/anchoring');
    require('./components/bdns');
    /*require('./components/fileManager');
    require('./components/bricksFabric');*/
    require('./components/staticServer');
    require('./components/keySsiNotifications');
    require('./components/debugLogger');
    require('./components/mqHub');
    require('./components/secrets');
    require('./components/mainDSU');
    require('./components/versionlessDSU');
    require('./components/stream');
    require('./components/requestForwarder');
    require('./components/lightDBEnclave');
    require("./components/activeComponents");
    //end
})();

function HttpServer({listeningPort, rootFolder, sslConfig, dynamicPort, restartIntervalCheck, retryTimeout}, callback) {
    if (typeof restartIntervalCheck === "undefined") {
        restartIntervalCheck = CHECK_FOR_RESTART_COMMAND_FILE_INTERVAL;
    }
    let port = listeningPort || 8080;
    const conf = require('./http-wrapper/config').getConfig();
    const server = new Server(sslConfig);
    server.config = conf;
    server.rootFolder = rootFolder;
    server.timeout = conf.timeout || (60 * 1000) + 1000;
    server.requestTimeout = conf.requestTimeout || 300 * 1000;

    server.keepAliveTimeout = conf.keepAliveTimeout || (60 * 1000) + 1000;

    server.getHeadHandler = function (handler) {
        return function (req, res, next) {
            res.write = function () {

            }
            let originalEnd = res.end;
            res.end = function () {
                originalEnd.call(res);
            }

            handler(req, res, next);
        }
    }

    let permanentWarnings = [];
    server.registerPermanentWarning = (componentName, error) => {
        permanentWarnings.push({componentName, error});
    }

    let displayPermanentWarnings = function () {
        for (let warning of permanentWarnings) {
            let {error, componentName} = warning;
            logger.warning(`Component ${componentName} has an permanent warning!`, error);
        }
    }

    server.use((req, res, next) => {
        if (permanentWarnings.length) {
            logger.warning("The server seems to be in a wrong state!", `${permanentWarnings.length} warning(s):`);
            displayPermanentWarnings();
        }
        next();
    });

    let listenCallback = (err) => {
        if (err) {
            if (!dynamicPort && callback) {
                return OpenDSUSafeCallback(callback)(createOpenDSUErrorWrapper(`Failed to listen on port <${port}>`, err));
            }
            if (dynamicPort && err.code === 'EADDRINUSE') {
                logger.debug(`Port ${port} is already in use. Trying to find another one...`);

                function getRandomPort() {
                    const min = 9000;
                    const max = 65535;
                    return Math.floor(Math.random() * (max - min) + min);
                }

                port = getRandomPort();
                if (Number.isInteger(dynamicPort)) {
                    dynamicPort -= 1;
                }
                let timeValue = retryTimeout || CHECK_FOR_RESTART_COMMAND_FILE_INTERVAL;
                setTimeout(bootup, timeValue);
            } else {
                logger.error(err);
            }
        }
    };

    function bootup() {
        logger.debug(`Trying to listen on port ${port}`);
        server.listen(port, conf.host, listenCallback);
    }

    bootup();

    if (restartIntervalCheck) {
        setInterval(function () {
            let restartServerFile = server.rootFolder + '/needServerRestart';
            const fsname = "fs";
            const fs = require(fsname);
            fs.readFile(restartServerFile, function (error, content) {
                if (!error && content.toString() !== "") {
                    logger.debug(`### Preparing to restart because of the request done by file: <${restartServerFile}> File content: ${content}`);
                    server.close();
                    server.listen(port, conf.host, () => {
                        fs.writeFile(restartServerFile, "", function () {
                            //we don't care about this file.. we just clear it's content the prevent recursive restarts
                            logger.debug(`### Restart operation finished.`);
                        });
                    });
                }
            });
        }, restartIntervalCheck);
    }

    server.on('listening', bindFinished);
    server.on('error', listenCallback);

    let accessControlAllowHeaders = new Set();
    accessControlAllowHeaders.add("Content-Type");
    accessControlAllowHeaders.add("Content-Length");
    accessControlAllowHeaders.add("X-Content-Length");
    accessControlAllowHeaders.add("Access-Control-Allow-Origin");
    accessControlAllowHeaders.add("User-Agent");
    accessControlAllowHeaders.add("Authorization");
    accessControlAllowHeaders.add("ETag");

    server.registerAccessControlAllowHeaders = function (headers) {
        if (headers) {
            if (Array.isArray(headers)) {
                for (let i = 0; i < headers.length; i++) {
                    accessControlAllowHeaders.add(headers[i]);
                }
            } else {
                accessControlAllowHeaders.add(headers);
            }
        }
    }

    server.getAccessControlAllowHeadersAsString = function () {
        let headers = "";
        let notFirst = false;
        for (let header of accessControlAllowHeaders) {
            if (notFirst) {
                headers += ", ";
            }
            notFirst = true;
            headers += header;
        }
        return headers;
    }

    function bindFinished(err) {
        if (err) {
            logger.error(err);
            if (callback) {
                return OpenDSUSafeCallback(callback)(createOpenDSUErrorWrapper(`Failed to bind on port <${port}>`, err));
            }
            return;
        }

        registerEndpoints(callback);
    }

    let endpointsAlreadyRegistered = false;

    function registerEndpoints(callback) {
        //The purpose of this flag is to prevent endpoints registering again
        //in case of a restart requested by file needServerRestart present in rootFolder
        if (endpointsAlreadyRegistered) {
            return;
        }
        endpointsAlreadyRegistered = true;
        server.use(function (req, res, next) {
            res.setHeader('Access-Control-Allow-Origin', req.headers.origin || req.headers.host || "*");
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', server.getAccessControlAllowHeadersAsString());
            res.setHeader('Access-Control-Allow-Credentials', true);
            next();
        });

        server.options('/*', function (req, res) {
            const headers = {};
            //origin header maybe missing (eg. Postman call or proxy that doesn't forward the origin header etc.)
            if (req.headers.origin) {
                headers['Access-Control-Allow-Origin'] = req.headers.origin;
            } else {
                headers['Access-Control-Allow-Origin'] = '*';
            }
            headers['Access-Control-Allow-Methods'] = 'POST, GET, PUT, DELETE, OPTIONS';
            headers['Access-Control-Allow-Credentials'] = true;
            headers['Access-Control-Max-Age'] = '3600'; //one hour
            headers['Access-Control-Allow-Headers'] = server.getAccessControlAllowHeadersAsString();

            if (conf.CORS) {
                logger.debug("Applying custom CORS headers");
                for (let prop in conf.CORS) {
                    headers[prop] = conf.CORS[prop];
                }
            }

            res.writeHead(200, headers);
            res.end();
        });

        function addRootMiddlewares() {
            const LoggerMiddleware = require('./middlewares/logger');
            const ReadOnly = require("./middlewares/readOnly");
            const AuthorisationMiddleware = require('./middlewares/authorisation');
            const Throttler = require('./middlewares/throttler');
            const OAuth = require('./middlewares/oauth');
            const ClientCredentialsOAuth = require('./middlewares/clientCredentialsOauth');
            const SimpleAuth = require('./middlewares/simpleAuth');
            const APIKeyAuthorisation = require('./middlewares/apiKeyAuth');
            const FixedUrls = require('./middlewares/fixedUrls');
            const SimpleLock = require('./middlewares/SimpleLock');
            const ResponseHeaderMiddleware = require('./middlewares/responseHeader');
            const genericErrorMiddleware = require('./middlewares/genericErrorMiddleware');
            const requestEnhancements = require('./middlewares/requestEnhancements');
            const CacheControl = require('./middlewares/cacheControl');

            server.use(function gracefulTerminationWatcher(req, res, next) {
                const allowedUrls = [/*"/installation-details", "/ready-probe"*/];
                if (process.shuttingDown && allowedUrls.indexOf(req.url) === -1) {
                    //uncaught exception was caught so server is shutting down gracefully and not accepting any requests
                    res.statusCode = 503;
                    logger.log(0x02, `Rejecting ${req.url} with status code ${res.statusCode} because process is shutting down.`);
                    res.end();
                    return;
                }
                //if the url is allowed or shuttingDown flag not present, we let the request go on...
                next();
            });

            if (conf.enableRequestLogger) {
                new LoggerMiddleware(server);
            }

            if (conf.enableReadOnlyMechanism) {
                ReadOnly(server);
            }

            if (conf.enableErrorCloaking) {
                genericErrorMiddleware(server);
            }
            requestEnhancements(server);
            Throttler(server);
            FixedUrls(server);
            SimpleLock(server);

            if (conf.enableJWTAuthorisation) {
                new AuthorisationMiddleware(server);
            }

            APIKeyAuthorisation(server);

            if (conf.enableClientCredentialsOauth) {
                ClientCredentialsOAuth(server);
            }

            if (conf.enableSimpleAuth && process.env.ENABLE_SSO !== "false") {
                SimpleAuth(server);
            }

            if (conf.enableOAuth && process.env.ENABLE_SSO !== "false") {
                new OAuth(server);
            }

            if(conf.cacheDurations && Array.isArray(conf.cacheDurations) && conf.cacheDurations.length > 0) {
                logger.info("cacheControl middleware is active.");
                CacheControl(server);
            }

            if (conf.responseHeaders) {
                new ResponseHeaderMiddleware(server);
            }

            if (conf.enableInstallationDetails) {
                const enableInstallationDetails = require("./components/installation-details");
                enableInstallationDetails(server);
            }
        }

        function addComponent(componentName, componentConfig, callback) {
            const path = require("swarmutils").path;

            let componentPath = componentConfig.module;
            if (componentPath.startsWith('.') && !conf.isDefaultComponent(componentName)) {
                componentPath = path.resolve(path.join(process.env.PSK_ROOT_INSTALATION_FOLDER, componentPath));
            }
            logger.debug(`Preparing to register middleware from path ${componentPath}`);

            let middlewareImplementation;
            try {
                middlewareImplementation = require(componentPath);
            } catch (e) {
                server.registerPermanentWarning(componentName, e);
                if (callback) {
                    callback();
                }
                return;
            }
            let asyncLoadingComponent = false;
            const calledByAsyncLoadingComponent = () => {
                asyncLoadingComponent = true;
                //if the component calls before returning this function means that needs more time, is doing async calls etc.
            }

            let args = [server];

            if (callback) {
                args.push(calledByAsyncLoadingComponent);
                args.push(callback);
            }

            try {
                if (typeof componentConfig.function !== 'undefined') {
                    middlewareImplementation[componentConfig.function](...args);
                } else {
                    middlewareImplementation(...args);
                }
            } catch (err) {
                server.registerPermanentWarning(componentName, err);
                if (callback) {
                    callback();
                }
                return;
            }

            if (!asyncLoadingComponent && callback) {
                callback();
            }
        }

        function addComponents(cb) {
            const requiredComponentNames = ["config"];
            //addComponent("config", {module: "./components/config"});
            addComponent("activeComponents", {module: "./components/activeComponents"});

            // take only the components that have configurations and that are not part of the required components
            const middlewareList = [...conf.activeComponents]
                .filter(activeComponentName => {
                    let include = conf.componentsConfig[activeComponentName];
                    if (!include) {
                        logger.debug(`Not able to find config for component called < ${activeComponentName} >. Excluding it from the active components list!`);
                    }
                    return include;
                })
                .filter(activeComponentName => !requiredComponentNames.includes(activeComponentName));

            const addRequiredComponent = (componentName) => {
                if (!middlewareList.includes(`${componentName}`)) {
                    logger.warn(`WARNING: ${componentName} component is not configured inside activeComponents!`)
                    logger.warn(`WARNING: temporary adding ${componentName} component to activeComponents! Please make sure to include ${componentName} component inside activeComponents!`)

                    const addComponentToComponentList = (list) => {
                        const indexOfStaticServer = list.indexOf("staticServer");
                        if (indexOfStaticServer !== -1) {
                            // staticServer needs to load last
                            list.splice(indexOfStaticServer, 0, componentName);
                        } else {
                            list.push(componentName);
                        }
                    }

                    addComponentToComponentList(middlewareList);
                    // need to also register to defaultComponents in order to be able to load the module correctly
                    addComponentToComponentList(conf.defaultComponents);
                }
            }

            addRequiredComponent("mainDSU");
            addRequiredComponent("lightDBEnclave");

            function installNextComponent(componentList) {
                const componentName = componentList[0];
                const componentConfig = conf.componentsConfig[componentName];
                addComponent(componentName, componentConfig, () => {
                    componentList.shift();
                    if (componentList.length > 0) {
                        return installNextComponent(componentList);
                    }
                    if (cb) {
                        cb();
                    }
                });
            }

            if (middlewareList.indexOf("staticServer") === -1) {
                middlewareList.push("staticServer");
            }

            installNextComponent(middlewareList);
        }

        addRootMiddlewares();
        addComponents(() => {
            //at this point all components were installed and we need to register the fallback handler
            logger.debug("Registering the fallback handler. Any endpoint registered after this one will have zero changes to be executed.");
            server.use(function (req, res) {
                logger.debug("Response handled by fallback handler.");
                res.statusCode = 404;
                res.end();
            });
            if (callback) {
                return callback();
            }
        });
    }

    return server;
}

module.exports.createInstance = function (port, folder, sslConfig, callback) {
    if (typeof sslConfig === 'function') {
        callback = sslConfig;
        sslConfig = undefined;
    }

    return new HttpServer({listeningPort: port, rootFolder: folder, sslConfig}, callback);
};

module.exports.start = function (options, callback) {
    return new HttpServer(options, callback);
}

module.exports.getHttpWrapper = function () {
    return require('./http-wrapper');
};

module.exports.getServerConfig = function () {
    logger.debug(`apihub.getServerConfig() method is deprecated, please use server.config to retrieve necessary info.`);
    const config = require('./http-wrapper/config');
    return config.getConfig();
};

module.exports.getDomainConfig = function (domain, ...configKeys) {
    logger.debug(`apihub.getServerConfig() method is deprecated, please use server.config.getDomainConfig(...) to retrieve necessary info.`);
    const config = require('./http-wrapper/config');
    return config.getDomainConfig(domain, ...configKeys);
};

module.exports.middlewares = {
    ReadOnly: require("./middlewares/readOnly")
}

module.exports.getSecretsServiceInstanceAsync = require("./components/secrets/SecretsService").getSecretsServiceInstanceAsync;

module.exports.anchoringStrategies = require("./components/anchoring/strategies");

module.exports.TokenBucket = require("./http-wrapper/src/TokenBucket");