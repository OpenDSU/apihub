function StaticServer(server) {
    const fs = require("fs");
    const path = require('swarmutils').path;
    const utils = require("../../http-wrapper/utils");
    const config = require("../../http-wrapper/config");
    let componentsConfig = config.getConfig("componentsConfig");
    const logger = $$.getLogger("StaticServer", "apihub/staticServer");
    const excludedFiles = ["apihub.json"];
    let excludedFilesRegex;
    if (componentsConfig && componentsConfig.staticServer && componentsConfig.staticServer.excludedFiles) {
        excludedFilesRegex = componentsConfig.staticServer.excludedFiles.map(str => new RegExp(str));
    }

    function sanitizeFilePath(unsafePath) {
        // Step 1: Replace null bytes (common trick in path traversal)
        let safePath = unsafePath.replace(/\0/g, '');

        // Step 2: Normalize the path to remove things like "../" and "./"
        safePath = path.normalize(safePath);

        // Step 3: Ensure that the path doesn't attempt to go outside the base directory
        // We remove any leading slashes or "./" so that it's a relative path
        safePath = safePath.replace(/^(\.\.(\/|\\|$))+/, '');

        return safePath;
    }

    function sendFiles(req, res, next) {
        const prefix = "/directory-summary/";
        requestValidation(req, "GET", prefix, function (notOurResponsibility, targetPath) {
            if (notOurResponsibility) {
                return next();
            }
            targetPath = targetPath.replace(prefix, "");
            serverTarget(targetPath);
        });

        function serverTarget(targetPath) {
            logger.debug("Serving summary for dir:", targetPath);
            fs.stat(targetPath, function (err, stats) {
                if (err) {
                    logger.info(0x04, `Path <${targetPath}> was not found`)
                    res.statusCode = 404;
                    res.end();
                    return;
                }
                if (!stats.isDirectory()) {
                    logger.info(0x04, `<${targetPath}> is not a directory`)
                    res.statusCode = 403;
                    res.end();
                    return;
                }

                function send() {
                    res.statusCode = 200;
                    res.setHeader('Content-Type', "application/json");
                    //let's clean some empty objects
                    for (let prop in summary) {
                        if (Object.keys(summary[prop]).length === 0) {
                            delete summary[prop];
                        }
                    }

                    res.write(JSON.stringify(summary));
                    res.end();
                }

                function checkIfReservedProp(prop){
                    let reservedProps = ["__proto__", "constructor", "prototype"];
                    return reservedProps.indexOf(prop) !== -1;
                }

                let summary = {};
                let directories = {};

                function extractContent(currentPath) {
                    directories[currentPath] = -1;

                    // Ensure that currentPath is inside the targetPath
                    let resolvedCurrentPath = sanitizeFilePath(path.resolve(currentPath));
                    let resolvedTargetPath = sanitizeFilePath(path.resolve(targetPath));

                    // Prevent path traversal by checking that resolvedCurrentPath is within resolvedTargetPath
                    if (!resolvedCurrentPath.startsWith(resolvedTargetPath) || resolvedCurrentPath.includes("..") || !path.isAbsolute(resolvedCurrentPath)) {
                        logger.info(0x04, `Path traversal attempt detected`);
                        res.statusCode = 403;
                        res.end();
                        return;
                    }

                    let summaryId = currentPath.replace(targetPath, "");
                    summaryId = summaryId.split(path.sep).join("/");
                    if (summaryId === "") {
                        summaryId = "/";
                    }

                    if (checkIfReservedProp(summaryId)) {
                        logger.info(0x04, `Prototype pollution detected while constructing directory summary`);
                        res.statusCode = 403;
                        res.end();
                        return;
                    }

                    summary[summaryId] = {};

                    fs.readdir(resolvedCurrentPath, function (err, files) {
                        if (err) {
                            return markAsFinish(currentPath);
                        }
                        directories[currentPath] = files.length;

                        if (files.length === 0) {
                            return markAsFinish(currentPath);
                        } else {
                            for (let i = 0; i < files.length; i++) {
                                let file = sanitizeFilePath(files[i]);
                                if (checkIfReservedProp(file)) {
                                    logger.info(0x04, `Prototype pollution detected while constructing directory summary`);
                                    res.statusCode = 403;
                                    res.end();
                                    return;
                                }

                                const fileName = sanitizeFilePath(path.join(resolvedCurrentPath, file));
                                let resolvedFileName = sanitizeFilePath(path.resolve(fileName));

                                try{
                                    let swarmUtils = require('swarmutils');
                                    resolvedFileName = swarmUtils.validatePath(resolvedFileName);
                                }catch(err){
                                    logger.info(0x04, `Path traversal attempt detected`);
                                    res.statusCode = 403;
                                    res.end();
                                    return;
                                }

                                // Ensure that resolvedFileName is inside the targetPath
                                if (!resolvedFileName.startsWith(resolvedTargetPath) || resolvedFileName.includes("..") || !path.isAbsolute(resolvedFileName)) {
                                    logger.info(0x04, `Path traversal attempt detected`);
                                    res.statusCode = 403;
                                    res.end();
                                    return;
                                }

                                if (fs.statSync(resolvedFileName).isDirectory()) {
                                    extractContent(resolvedFileName);
                                } else {
                                    try {
                                        // Final sanitization right before reading the file to avoid tool warnings.
                                        let sanitizedResolvedFileName;
                                        try{
                                            let swarmUtils = require("swarmutils");
                                            sanitizedResolvedFileName = swarmUtils.validatePath(resolvedFileName);
                                        }catch (err){
                                            logger.error(`Path traversal detected`);
                                            res.statusCode = 403;
                                            res.end();
                                            return;
                                        }

                                        let fileContent = fs.readFileSync(sanitizedResolvedFileName);  // File path is now fully sanitized.
                                        let fileExtension = path.extname(fileName).slice(1);  // Safely extract the extension
                                        let mimeType = utils.getMimeTypeFromExtension(fileExtension);

                                        if (mimeType.binary) {
                                            summary[summaryId][file] = Array.from(fileContent);
                                        } else {
                                            summary[summaryId][file] = fileContent.toString();
                                        }
                                    } catch (error) {
                                        logger.error(`Error reading file ${resolvedFileName}: ${error.message}`);
                                        res.statusCode = 403;
                                        res.end();
                                        return;
                                    }
                                }
                                directories[currentPath]--;
                            }
                            return markAsFinish(currentPath);
                        }
                    });
                }

                function markAsFinish(targetPath) {
                    if (directories [targetPath] > 0) {
                        return;
                    }
                    delete directories [targetPath];
                    const dirsLeftToProcess = Object.keys(directories);
                    //if there are no other directories left to process
                    if (dirsLeftToProcess.length === 0) {
                        send();
                    }
                }

                extractContent(targetPath);
            })
        }

    }

    function tryToCreateAtRuntimeFromTemplates(req, callback) {

        let adminService;
        try {
            adminService = require("./../admin").getAdminService();
        } catch (err) {
            //logger.error("Caught an error durring admin service initialization", err);
            return callback(err);
        }

        adminService.checkForTemplate(req.url, (err, template) => {
            if (err) {
                //logger.error("Not able to find template for", req.url);
                //console.trace(err);
                return callback(err);
            }
            if (template) {
                let fileContent = template.content;
                const urlObject = new URL(req.url, `http://${req.headers.host}`);
                let hostname = urlObject.hostname;
                return adminService.getDomainSpecificVariables(hostname, (err, variables) => {
                    if (err || !variables) {
                        return callback(err);
                    }
                    let domainVariables = Object.keys(variables);
                    for (let i = 0; i < domainVariables.length; i++) {
                        let variableName = domainVariables[i];
                        let variableValue = variables[variableName];

                        const lookupFor = "${" + variableName + "}";
                        fileContent = fileContent.split(lookupFor).join(variableValue);
                    }

                    return callback(undefined, fileContent);
                });
            } else {
                return callback(new Error(`No template found for ${req.url}`));
            }
        });
    }

    function resolveFileAndSend(req, res, file) {
        tryToCreateAtRuntimeFromTemplates(req, (err, content) => {
            if (err) {
                //console.trace(err);
                //if any error... we fallback to normal sendFile method
                return sendFile(res, file);
            }
            logger.debug("Responding with template instead of file.");
            res.statusCode = 200;

            setMimeTypeOnResponse(req.url, res);

            res.setHeader('Cache-Control', 'no-store');
            if (req.method === "HEAD") {
                return res.end();
            }
            res.end(content);
        });
    }

    function setMimeTypeOnResponse(file, res) {
        let ext = path.extname(file);

        if (ext !== "") {
            ext = ext.replace(".", "");
            res.setHeader('Content-Type', utils.getMimeTypeFromExtension(ext).name);
        } else {
            res.setHeader('Content-Type', "application/octet-stream");
        }
    }

    function sendFile(res, file) {
        if (excludedFiles.includes(require("path").basename(file))) {
            res.statusCode = 403;
            res.end();
            return;
        }

        if (excludedFilesRegex) {
            let index = excludedFilesRegex.findIndex(regExp => file.match(regExp) !== null);
            if (index >= 0) {
                res.statusCode = 403;
                res.end();
                return;
            }
        }

        // e.g. cacheDuration = [{urlPattern:"/assets/", duration: 3600, method: "startsWith"}]
        // urlPattern should be a string which should be matched by the selected method when trying to serve a specific url
        // duration should be a number and will be used to set the Cache Control value
        // method can be String.startsWith (default), String.endsWith,  RegExp.test
        let cacheDurations = componentsConfig.staticServer.cacheDurations || [];
        let cacheDuration = 0;  // Default to no-cache

        for (let entry of cacheDurations){
            let {urlPattern, duration, method} = entry;

            let fnc = res.req.url.startsWith.bind(res.req.url);
            switch (method) {
                case "endsWith":
                    fnc = res.req.url.endsWith.bind(res.req.url);
                    break;
                case "test":
                    fnc = function(urlPattern){
                        return new RegExp(urlPattern).test(res.req.url);
                    }
                    break;
                default:
                    // nothing...
            }

            if (fnc(urlPattern)) {
                cacheDuration = duration || cacheDuration;
                break;
            }
        }

        if (cacheDuration > 0) {
            res.setHeader('Cache-Control', `public, max-age=${cacheDuration}`);
        } else {
            res.setHeader('Cache-Control', 'no-store');
        }

        let stream = fs.createReadStream(file);
        setMimeTypeOnResponse(file, res);
        res.statusCode = 200;
        if (res.req.method === "HEAD") {
            return res.end();
        }
        stream.pipe(res);
        stream.on('finish', () => {
            res.end();
        });
    }

    function requestValidation(req, method, urlPrefix, callback) {
        if (typeof urlPrefix === "function") {
            callback = urlPrefix;
            urlPrefix = undefined;
        }

        if (req.method !== method && req.method !== "HEAD") {
            //we resolve only GET and HEAD requests
            return callback(true);
        }

        if (typeof urlPrefix !== "undefined") {
            if (req.url.indexOf(urlPrefix) !== 0) {
                return callback(true);
            }
        }

        const path = require("swarmutils").path;
        let rootFolder = server.rootFolder;
        if (componentsConfig && componentsConfig.staticServer && componentsConfig.staticServer.root) {
            rootFolder = path.resolve(componentsConfig.staticServer.root);
        }

        let requestedUrl = new URL(req.url, `http://${req.headers.host}`);
        let requestedUrlPathname = requestedUrl.pathname;
        if (urlPrefix) {
            requestedUrlPathname = requestedUrlPathname.replace(urlPrefix, "");
        }
        let targetPath = path.resolve(path.join(rootFolder, requestedUrlPathname));
        //if we detect tricks that tries to make us go above our rootFolder to don't resolve it!!!!

        if (targetPath.indexOf(rootFolder) !== 0) {
            return callback(true);
        }

        callback(false, targetPath);
    }

    function redirect(req, res, next) {
        requestValidation(req, "GET", function (notOurResponsibility, targetPath) {
            if (notOurResponsibility) {
                return next();
            }
            //from now on we mean to resolve the url
            //remove existing query params
            fs.stat(targetPath, function (err, stats) {
                if (err) {
                    return tryToCreateAtRuntimeFromTemplates(req, (err, content) => {
                        if (err) {
                            //if any error... we have to return 404
                            logger.info(0x04, `Failed to create from templates`)
                            res.statusCode = 404;
                            res.end();
                            return;
                        }
                        res.statusCode = 200;
                        res.setHeader('Cache-Control', 'no-store');
                        if (req.method === "HEAD") {
                            return res.end();
                        }
                        res.end(content);
                    });
                }

                if (stats.isDirectory()) {

                    let protocol = req.socket.encrypted ? "https" : "http";
                    let url = new URL(req.url, `${protocol}://${req.headers.host}`);

                    if (url.pathname[url.pathname.length - 1] !== "/") {
                        res.writeHead(302, {
                            'Location': url.pathname + "/" + url.search
                        });
                        res.end();
                        return;
                    }

                    const defaultFileName = "index.html";
                    const defaultPath = path.join(targetPath, defaultFileName);
                    fs.stat(defaultPath, function (err) {
                        if (err) {
                            logger.info(0x04, `Path <${defaultPath}> was not found`)
                            res.statusCode = 403;
                            res.end();
                            return;
                        }

                        return resolveFileAndSend(req, res, defaultPath);
                    });
                } else {
                    return resolveFileAndSend(req, res, targetPath);
                }
            });
        });
    }

    server.use("*", sendFiles);
    server.use("*", redirect);
}

module.exports = StaticServer;
