const TAG_FIXED_URL_REQUEST = "fixedurlrequest";
const INTERVAL_TIME = 1 * 1000; //ms aka 1 sec
const DEFAULT_MAX_AGE = 10; //seconds aka 10 sec
const TASKS_TABLE = "tasks";
const HISTORY_TABLE = "history";
const DATABASE = "FixedUrls.db";

const LokiDatabase = require("loki-enclave-facade");
const fsname = "fs";
const fs = require(fsname);
const pathname = "path";
const path = require(pathname);
const logger = $$.getLogger("FixedUrl", "apihub/logger");

module.exports = function (server) {

    const workingDir = path.join(server.rootFolder, "external-volume", "fixed-urls");
    const storage = path.join(workingDir, "storage");
    const databasePersistence = path.join(workingDir, DATABASE);
    let database;

    let watchedUrls = [];
    //we inject a helper function that can be called by different components or middleware to signal that their requests
    // can be watched by us
    server.allowFixedUrl = function (url) {
        if (!url) {
            throw new Error("Expected an Array of strings or single string representing url prefix");
        }
        if (Array.isArray(url)) {
            watchedUrls = watchedUrls.concat(url);
            return;
        }
        watchedUrls.push(url);
    }

    function ensureURLUniformity(req) {
        let base = "https://non.relevant.url.com";
        //we add the base to get a valid url
        let converter = new URL(base + req.url);
        //we ensure that the searchParams are sorted
        converter.searchParams.sort();
        //we remove our artificial base
        let newString = converter.toString().replaceAll(base, "");
        return newString;
    }

    function respond(res, content, statusCode) {
        if(statusCode){
            res.statusCode = statusCode;
            logger.audit(0x102, `Responding to url ${res.req.url} with status code ${statusCode}`);
        }else{
            logger.audit(0x101, `Successful serving url ${res.req.url}`);
            res.statusCode = 200;
        }
        const fixedURLExpiry = server.config.fixedURLExpiry || DEFAULT_MAX_AGE;
        res.setHeader("cache-control", `max-age=${fixedURLExpiry}`);
        res.write(content);
        res.end();
    }

    function getIdentifier(fixedUrl){
        return Buffer.from(fixedUrl).toString("base64");
    }

    const indexer = {
        getFileName: function (fixedUrl) {
            return path.join(storage, getIdentifier(fixedUrl));
        },
        persist:function(fixedUrl, content, callback){
            logger.debug("Persisting url", fixedUrl);
            fs.writeFile(indexer.getFileName(fixedUrl), content, callback);
        },
        get:function(fixedUrl, callback){
            logger.debug("Reading url", fixedUrl);
            fs.readFile(indexer.getFileName(fixedUrl), callback);
        },
        clean:function(fixedUrl, callback){
            logger.debug("Cleaning url", fixedUrl);
            fs.unlink(indexer.getFileName(fixedUrl), callback);
        }
    };

    const taskRegistry = {
        inProgress:{},
        createModel:function(fixedUrl){
            return {url: fixedUrl, pk: getIdentifier(fixedUrl)};
        },
        register:function(task, callback){
            let newRecord = taskRegistry.createModel(task);
            database.getRecord(undefined, HISTORY_TABLE, newRecord.pk, function (err, record){
                if(err || !record){
                    database.insertRecord(undefined, HISTORY_TABLE, newRecord.pk, newRecord, callback);
                }
                return callback(undefined);
            });
        },
        add:function(task, callback){
            let newRecord = taskRegistry.createModel(task);
            database.getRecord(undefined, TASKS_TABLE, newRecord.pk, function (err, record){
                if(err || !record){
                    return database.insertRecord(undefined, TASKS_TABLE, newRecord.pk, newRecord, callback);
                }
                if(!record.counter){
                    record.counter = 0;
                }
                record.counter++;
                return database.updateRecord(undefined, TASKS_TABLE, record.pk, record, callback)
            });
        },
        remove:function(task, callback){
            let toBeRemoved = taskRegistry.createModel(task);
            database.getRecord(undefined, TASKS_TABLE, toBeRemoved.pk, function(err, record){
                if(err || !record){
                    return callback(undefined);
                }
                if(record.counter && record.counter > 1){
                    record.counter = 1;
                    return database.updateRecord(undefined, TASKS_TABLE, toBeRemoved.pk, record, callback);
                }

                database.deleteRecord(undefined, TASKS_TABLE, toBeRemoved.pk, callback);
            });
        },
        getOneTask:function(callback){
            database.filter(undefined, TASKS_TABLE, "__timestamp > 0", "asc", 1, function(err, task){
                if(err){
                    return callback(err);
                }
                if(task.length === 0){
                    return callback(undefined);
                }
                task = task[0];
                if(taskRegistry.inProgress[task.url]){
                    logger.debug(`${task.url} is in progress.`);
                    //we already have this task in progress, we need to wait
                    return callback(undefined);
                }
                taskRegistry.markInProgress(task.url);
                callback(undefined, task);
            });
        },
        isInProgress:function(task){
            return !!taskRegistry.inProgress[task];
        },
        isScheduled:function(task, callback){
            let tobeChecked = taskRegistry.createModel(task);
            database.getRecord(undefined, TASKS_TABLE, tobeChecked.pk, function(err, task){
                if(err || !task){
                    return callback(undefined, undefined);
                }
                callback(undefined, task);
            });
        },
        markInProgress:function(task){
            taskRegistry.inProgress[task] = true;
        },
        markAsDone:function(task, callback){
            logger.debug(`Marking task ${task} as done`);
            taskRegistry.inProgress[task] = undefined;
            delete taskRegistry.inProgress[task];
            taskRegistry.remove(task, callback);
        },
        isKnown:function(task, callback){
            let target = taskRegistry.createModel(task);
            database.getRecord(undefined, HISTORY_TABLE, target.pk, callback);
        },
        schedule:function(criteria, callback){
            database.filter(undefined, HISTORY_TABLE, criteria, function(err, records){
                if(err){
                    if(err.code === 404){
                        return callback();
                    }
                    return callback(err);
                }

                function createTask(){
                    if(records.length === 0){
                        return callback(undefined);
                    }

                    let record = records.pop();
                    taskRegistry.add(record.url, function (err){
                        if(err){
                            return callback(err);
                        }
                        createTask();
                    });
                }

                createTask();
            });
        },
        cancel:function(criteria, callback){
            database.filter(undefined, HISTORY_TABLE, criteria, async function(err, tasks){
                if(err){
                    if(err.code === 404){
                        return callback();
                    }
                    return callback(err);
                }

                try{
                    let markAsDone = $$.promisify(taskRegistry.markAsDone);
                    let clean = $$.promisify(indexer.clean);
                    for(let task of tasks){
                        let url = task.url;
                        //by marking it as done the task is removed from pending and database also
                        await markAsDone(url);
                        try{
                            await clean(url);
                        }catch(err){
                            //we ignore any errors related to file not found...
                            if(err.code !== "ENOENT"){
                                throw err;
                            }
                        }
                    }
                }catch(err){
                    return callback(err);
                }

                callback(undefined);
            });
        },
        status:function(){
            let inProgressCounter = Object.keys(taskRegistry.inProgress);
            logger.debug(`Number of tasks that are in progress: ${inProgressCounter ? inProgressCounter.length : 0}`);

            database.getAllRecords(undefined, TASKS_TABLE, (err, scheduledTasks)=>{
                if(!err){
                    logger.debug(`Number of scheduled tasks: ${scheduledTasks ? scheduledTasks.length : 0}`);
                }
            });
            database.getAllRecords(undefined, HISTORY_TABLE, (err, tasks)=>{
                if(!err){
                    logger.debug(`Number of fixed urls: ${tasks ? tasks.length : 0}`);
                }
            });
        }
    };
    const taskRunner = {
        doItNow:function(task){
            logger.info("Executing task for url", task.url);
            const fixedUrl = task.url;
            //we need to do the request and save the result into the cache
            let urlBase = `http://127.0.0.1`;
            let url = urlBase;
            if (!fixedUrl.startsWith("/")) {
                url += "/";
            }
            url += fixedUrl;

            //let's create an url object from our string
            let converter = new URL(url);
            //we inject the request identifier
            converter.searchParams.append(TAG_FIXED_URL_REQUEST, "true");
            //this new url will contain our flag that prevents resolving in our middleware
            url = converter.toString().replace(urlBase, "");

            //executing the request

            server.makeLocalRequest("GET", url, "", {}, function (error, result) {
                if (error) {
                    logger.error("caught an error during fetching fixedUrl", error.message, error.code, error);
                    if(error.httpCode && error.httpCode > 300){
                        //missing data
                        taskRunner.resolvePendingReq(task.url, "", error.httpCode);
                        logger.debug("Cleaning url because of the resolving error", error);
                        indexer.clean(task.url, (err)=>{
                            if(err){
                                if(err.code !== "ENOENT"){
                                    logger.error("Failed to clean url", err);
                                }
                            }
                        });
                        return taskRegistry.markAsDone(task.url, (err)=> {
                            if (err) {
                                logger.log("Failed to remove a task that we weren't able to resolve");
                                return;
                            }
                        });
                    }
                    return taskRegistry.markAsDone(task.url, (err)=>{
                        if (err) {
                            logger.log("Failed to remove a task that we weren't able to resolve");
                            return;
                        }
                        //if failed we add the task back to the end of the queue...
                        setTimeout(()=>{
                            taskRegistry.add(task.url,(err)=>{
                                if(err){
                                    logger.log("Failed to reschedule the task", task.url, err.message, err.code, err);
                                }
                            });
                        }, 100);
                    })
                }
                //got result... we need to store it for future requests, and we need to resolve any pending request waiting for it
                if (result) {
                    //let's resolve as fast as possible any pending request for the current task
                    taskRunner.resolvePendingReq(task.url, result);

                    if(!taskRegistry.isInProgress(task.url)){
                        logger.info("Looks that somebody canceled the task before we were able to resolve.");
                        //if somebody canceled the task before we finished the request we stop!
                        return ;
                    }

                    indexer.persist(task.url, result, function (err) {
                        if (err) {
                            logger.error("Not able to persist fixed url", task, err);
                        }

                        taskRegistry.markAsDone(task.url, (err) => {
                            if (err) {
                                logger.warn("Failed to mark request as done in database", task);
                            }
                        });

                        //let's test if we have other tasks that need to be executed...
                        taskRunner.execute();
                    });
                }else{
                    taskRegistry.markAsDone(task.url, (err) => {
                        if (err) {
                            logger.warn("Failed to mark request as done in database", task);
                        }
                        taskRunner.resolvePendingReq(task.url, result, 204);
                    });
                }
            });
        },
        execute:function(){
            taskRegistry.getOneTask(function(err, task){
                if(err || !task){
                    return;
                }

                taskRunner.doItNow(task);
            })
        },
        pendingRequests:{},
        registerReq: function(url, req, res){
            if(!taskRunner.pendingRequests[url]){
                taskRunner.pendingRequests[url] = [];
            }
            taskRunner.pendingRequests[url].push({req, res});
        },
        resolvePendingReq: function(url, content, statusCode){
            let pending = taskRunner.pendingRequests[url];
            if(!pending){
                return;
            }
            while(pending.length>0){
                let delayed = pending.shift();
                try{
                    respond(delayed.res, content, statusCode);
                }catch(err){
                    //we ignore any errors at this stage... timeouts, client aborts etc.
                }
            }
        },
        status: function(){
            let pendingReq = Object.keys(taskRunner.pendingRequests);
            let counter = 0;
            for(let pendingUrl of pendingReq){
                if(taskRunner.pendingRequests[pendingUrl]){
                    counter += taskRunner.pendingRequests[pendingUrl].length;
                }
            }

            logger.debug(`Number of requests that are in pending: ${counter}`);
            taskRegistry.status();
        }
    };

    fs.mkdir(storage, {recursive: true}, (err) => {
        if (err) {
            logger.error("Failed to ensure folder structure due to", err);
        }
        database = new LokiDatabase(databasePersistence, INTERVAL_TIME, LokiDatabase.prototype.Adaptors.FS);

        setInterval(taskRunner.execute, INTERVAL_TIME);
        setInterval(taskRunner.status, 1*60*1000);//each minute
    });

    server.put("/registerFixedURLs", require("./../../utils/middlewares").bodyReaderMiddleware);
    server.put("/registerFixedURLs", function register(req, res, next){
        if(!database){
            return setTimeout(()=>{
                register(req, res, next);
            }, 100);
        }
        let body = req.body;
        try{
            body = JSON.parse(body);
        }catch(err){
            logger.log(err);
        }

        if(!Array.isArray(body)){
            body = [body];
        }

        function recursiveRegistry(){
            if(body.length === 0){
                res.statusCode = 200;
                res.end();
                return;
            }
            let fixedUrl = body.pop();
            taskRegistry.register(fixedUrl, function(err){
                if(err){
                    res.statusCode = 500;
                    return res.end(err.message);
                }
                recursiveRegistry();
            });
        }

        recursiveRegistry();
    });

    server.put("/activateFixedURL", require("./../../utils/middlewares").bodyReaderMiddleware);
    server.put("/activateFixedURL", function activate(req, res, next){
        if(!database){
            return setTimeout(()=>{
                activate(req, res, next);
            }, 100);
        }
        taskRegistry.schedule(req.body.toString(), function (err){
            if(err){
                logger.log(err);
                res.statusCode = 500;
                return res.end();
            }
            res.statusCode = 200;
            res.end();
        });
    });

    server.put("/deactivateFixedURL", require("./../../utils/middlewares").bodyReaderMiddleware);
    server.put("/deactivateFixedURL", function deactivate(req, res, next){
        if(!database){
            return setTimeout(()=>{
                deactivate(req, res, next);
            }, 100);
        }
        taskRegistry.cancel(req.body.toString(), function (err){
            if(err){
                logger.log(err);
                res.statusCode = 500;
                return res.end();
            }
            res.statusCode = 200;
            res.end();
        });
    });

    //register a middleware to intercept all the requests
    server.use("*", function (req, res, next) {

        if (req.method !== "GET") {
            //not our responsibility... for the moment we resolve only GET methods that have query params...
            return next();
        }

        let possibleFixedUrl = false;
        for (let url of watchedUrls) {
            if (req.url.startsWith(url)) {
                possibleFixedUrl = true;
            }
        }

        if (!possibleFixedUrl) {
            //not our responsibility
            return next();
        }



        if (req.query && req.query[TAG_FIXED_URL_REQUEST]) {
            //this TAG_FIXED_URL_REQUEST query param is set by our runner, and we should let this request to be executed
            return next();
        }

        //if we reached this line of code means that we need to do our "thing"
        let fixedUrl = ensureURLUniformity(req);
        if(taskRegistry.isInProgress(fixedUrl)){
            //there is a task for it... let's wait
            return taskRunner.registerReq(fixedUrl, req, res);
        }

        function resolveURL(){
            taskRegistry.isScheduled(fixedUrl, (err, task)=>{
                if(task){
                    logger.debug(`There is a scheduled task for this ${fixedUrl}`);
                    taskRunner.registerReq(fixedUrl, req, res);
                    taskRegistry.markInProgress(fixedUrl);
                    taskRunner.doItNow(task);
                    return;
                }

                taskRegistry.isKnown(fixedUrl, (err, known) => {
                    if (known) {
                        //there is no task in progress for this url... let's test even more...
                        return indexer.get(fixedUrl, (err, content) => {
                            if (err) {
                                logger.warn(`Failed to load content for fixedUrl; highly improbable, check your configurations!`);
                                //no current task and no cache... let's move on to resolving the req
                                return next();
                            }
                            //known fixed url let's respond to the client
                            respond(res, content);
                        });
                    }
                    next();
                });
            });
        }

        taskRegistry.isKnown(fixedUrl, (err, known) => {
            //if reached this point it might be a fixed url that is not known yet, and it should get registered and scheduled for resolving...
            //this case could catch params combinations that are not captured...
            if (!known) {
                return taskRegistry.register(fixedUrl, (err)=>{
                    if(err){
                        //this should not happen... but even if it happens we log and go on with the execution
                        console.error(err);
                    }
                    taskRegistry.add(fixedUrl, (err)=>{
                        if(err){
                            //this should not happen... but even if it happens we log and go on with the execution
                            console.error(err);
                        }
                        resolveURL();
                    });
                });
            }
            resolveURL();
        });
    });
}