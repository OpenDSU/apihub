const logger = $$.getLogger("HttpServer", "apihub");

process.on('uncaughtException', err => {
	logger.critical('There was an uncaught error', err);
});

const httpWrapper = require('./libs/http-wrapper');
const Server = httpWrapper.Server;

const CHECK_FOR_RESTART_COMMAND_FILE_INTERVAL = 500;

(function loadDefaultComponents(){
	//next require lines are only for browserify build purpose
	// Remove mock
	require('./components/admin');
	require('./components/config');
	require('./components/contracts');
	require('./components/bricking');
	require('./components/anchoring');
	require('./components/bdns');
	require('./components/fileManager');
	require('./components/bricksFabric');
	require('./components/staticServer');
	require('./components/keySsiNotifications');
	require('./components/debugLogger');
	require('./components/mqHub');
	require('./components/enclave');
	require('./components/secrets');
	require('./components/mainDSU');
	require('./components/cloudWallet');
	require('./components/stream');
	require('./components/requestForwarder');
	//end
})();

function HttpServer({ listeningPort, rootFolder, sslConfig, dynamicPort, restartIntervalCheck, retryTimeout }, callback) {
	if(typeof restartIntervalCheck === "undefined"){
		restartIntervalCheck = CHECK_FOR_RESTART_COMMAND_FILE_INTERVAL;
	}

	let port = listeningPort || 8080;
	const conf =  require('./config').getConfig();
	const server = new Server(sslConfig);
	server.config = conf;
	server.rootFolder = rootFolder;
	let listenCallback = (err) => {
		if (err) {
			logger.error(err);
			if (!dynamicPort && callback) {
				return OpenDSUSafeCallback(callback)(createOpenDSUErrorWrapper(`Failed to listen on port <${port}>`, err));
			}
			if(dynamicPort && error.code === 'EADDRINUSE'){
				function getRandomPort() {
					const min = 9000;
					const max = 65535;
					return Math.floor(Math.random() * (max - min) + min);
				}
				port = getRandomPort();
				if(Number.isInteger(dynamicPort)){
					dynamicPort -= 1;
				}
				let timeValue = retryTimeout || CHECK_FOR_RESTART_COMMAND_FILE_INTERVAL;
				setTimeout(bootup, timeValue);
			}
		}
	};

	function bootup(){
		logger.trace(`Trying to listen on port ${port}`);
		server.listen(port, conf.host, listenCallback);
	}

	bootup();

	if(restartIntervalCheck){
		setInterval(function(){
			let restartServerFile = server.rootFolder + '/needServerRestart';
			const fsname = "fs";
			const fs = require(fsname);
			fs.readFile(restartServerFile, function(error, content) {
				if (!error && content.toString() !== "") {
					logger.trace(`### Preparing to restart because of the request done by file: <${restartServerFile}> File content: ${content}`);
					server.close();
					server.listen(port, conf.host, () => {
						fs.writeFile(restartServerFile, "", function(){
							//we don't care about this file.. we just clear it's content the prevent recursive restarts
							logger.trace(`### Restart operation finished.`);
						});
					});
				}
			});
		}, restartIntervalCheck);
	}

	server.on('listening', bindFinished);
	server.on('error', listenCallback);

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
		if(endpointsAlreadyRegistered){
			return ;
		}
		endpointsAlreadyRegistered = true;
		server.use(function (req, res, next) {
			res.setHeader('Access-Control-Allow-Origin', req.headers.origin || req.headers.host);
			res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
			res.setHeader('Access-Control-Allow-Headers', `Content-Type, Content-Length, X-Content-Length, Access-Control-Allow-Origin, token`);
			res.setHeader('Access-Control-Allow-Credentials', true);
			next();
		});

		server.options('/*', function (req, res) {
			const headers = {};
			// IE8 does not allow domains to be specified, just the *
			headers['Access-Control-Allow-Origin'] = req.headers.origin;
			// headers['Access-Control-Allow-Origin'] = '*';
			headers['Access-Control-Allow-Methods'] = 'POST, GET, PUT, DELETE, OPTIONS';
			headers['Access-Control-Allow-Credentials'] = true;
			headers['Access-Control-Max-Age'] = '3600'; //one hour
			headers['Access-Control-Allow-Headers'] = `Content-Type, Content-Length, X-Content-Length, Access-Control-Allow-Origin, User-Agent, Authorization, token`;

			if(conf.CORS){
				logger.trace("Applying custom CORS headers");
				for(let prop in conf.CORS){
					headers[prop] = conf.CORS[prop];
				}
			}

			res.writeHead(200, headers);
			res.end();
        });

        function addRootMiddlewares() {
			const LoggerMiddleware = require('./middlewares/logger');
			const AuthorisationMiddleware = require('./middlewares/authorisation');
			const Throttler = require('./middlewares/throttler');
			const OAuth = require('./middlewares/oauth');
			const ResponseHeaderMiddleware = require('./middlewares/responseHeader');
			const genericErrorMiddleware = require('./middlewares/genericErrorMiddleware');
			const requestEnhancements = require('./middlewares/requestEnhancements');

			if(conf.enableRequestLogger) {
				new LoggerMiddleware(server);
			}

			genericErrorMiddleware(server);
			requestEnhancements(server);
			Throttler(server);

            if(conf.enableJWTAuthorisation) {
                new AuthorisationMiddleware(server);
            }
			if(conf.enableOAuth && process.env.ENABLE_SSO !== "false") {
                new OAuth(server);
            }
			if(conf.responseHeaders){
				new ResponseHeaderMiddleware(server);
			}
            if(conf.enableInstallationDetails) {
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
            logger.trace(`Preparing to register middleware from path ${componentPath}`);

            let middlewareImplementation;
            try{
                middlewareImplementation = require(componentPath);
            } catch(e){
                throw e;
            }
			let asyncLodingComponent = false;
			const calledByAsynLoadingComponent = (cb)=>{
				asyncLodingComponent = true;
				//if the component calls before returning this function means that needs more time, is doing async calls etc.
			}

			let arguments = [server];

			if(callback) {
				arguments.push(calledByAsynLoadingComponent);
				arguments.push(callback);
			}

            if (typeof componentConfig.function !== 'undefined') {
                middlewareImplementation[componentConfig.function](...arguments);
            } else {
                middlewareImplementation(...arguments);
            }

			if(!asyncLodingComponent && callback){
				callback();
			}
        }

		function addComponents(cb) {
            const requiredComponentNames = ["config"];
            addComponent("config", {module: "./components/config"});

            // take only the components that have configurations and that are not part of the required components
			const middlewareList = [...conf.activeComponents]
                .filter(activeComponentName => {
                	let include = conf.componentsConfig[activeComponentName];
                	if(!include){
                		logger.trace(`Not able to find config for component called < ${activeComponentName} >. Excluding it from the active components list!`);
					}
                	return include;
				})
                .filter(activeComponentName => !requiredComponentNames.includes(activeComponentName));

            const addRequiredComponent = (componentName) => {
                if(!middlewareList.includes(`${componentName}`)) {
                    logger.warn(`WARNING: ${componentName} component is not configured inside activeComponents!`)
                    logger.warn(`WARNING: temporary adding ${componentName} component to activeComponents! Please make sure to include ${componentName} component inside activeComponents!`)

                    const addComponentToComponentList = (list) => {
                        const indexOfStaticServer = list.indexOf("staticServer");
                        if(indexOfStaticServer !== -1) {
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

            addRequiredComponent("cloudWallet");
            addRequiredComponent("mainDSU");

			function installNextComponent(componentList){
				const componentName = componentList[0];
				const componentConfig = conf.componentsConfig[componentName];
				addComponent(componentName, componentConfig, ()=>{
					componentList.shift();
					if(componentList.length>0){
						return installNextComponent(componentList);
					}
					if(cb){
						cb();
					}
				});
			}

			if(middlewareList.indexOf("staticServer") === -1) {
				middlewareList.push("staticServer");
			}

			installNextComponent(middlewareList);
		}

        addRootMiddlewares();
		addComponents(()=>{
			//at this point all components were installed and we need to register the fallback handler
			logger.trace("Registering the fallback handler. Any endpoint registered after this one will have zero changes to be executed.");
			server.use(function (req, res) {
				logger.trace("Response handled by fallback handler.");
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

	return new HttpServer({ listeningPort: port, rootFolder: folder, sslConfig }, callback);
};

module.exports.start = function(options, callback){
	return new HttpServer(options, callback);
}

module.exports.getHttpWrapper = function () {
	return require('./libs/http-wrapper');
};

module.exports.getServerConfig = function () {
	logger.warn(`apihub.getServerConfig() method is deprecated, please use server.config to retrieve necessary info.`);
	const config = require('./config');
	return config.getConfig();
};

module.exports.getDomainConfig = function (domain, ...configKeys) {
	logger.warn(`apihub.getServerConfig() method is deprecated, please use server.config.getDomainConfig(...) to retrieve necessary info.`);
	const config = require('./config');
	return config.getDomainConfig(domain, ...configKeys);
};

module.exports.anchoringStrategies = require("./components/anchoring/strategies");
