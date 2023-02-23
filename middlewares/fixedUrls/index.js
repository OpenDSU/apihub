const REQUEST_IDENTIFIER = "fixedurlrequest";
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

    function respond(res, content) {
        res.statusCode = 200;
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
            fs.writeFile(indexer.getFileName(fixedUrl), content, callback);
        },
        get:function(fixedUrl, callback){
            fs.readFile(indexer.getFileName(fixedUrl), callback);
        },
        clean:function(fixedUrl, callback){
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
                    database.insertRecord(undefined, TASKS_TABLE, newRecord.pk, newRecord, callback);
                }
                return callback(undefined);
            });
        },
        remove:function(task, callback){
            let toBeRemoved = taskRegistry.createModel(task);
            database.getRecord(undefined, TASKS_TABLE, toBeRemoved.pk, function(err, record){
                if(err || !record){
                    return callback(undefined);
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
                taskRegistry.inProgress[task.url] = true;
                callback(undefined, task);
            });
        },
        isInProgress:function(task){
            return !!taskRegistry.inProgress[task];
        },
        markAsDone:function(task, callback){
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
            database.filter(undefined, TASKS_TABLE, criteria, async function(err, tasks){
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
            database.getAllRecords(undefined, TASKS_TABLE, (err, scheduledTasks)=>{
                if(!err){
                    logger.debug(`Number of scheduled tasks: ${scheduledTasks.length}`);
                }
            });
            database.getAllRecords(undefined, HISTORY_TABLE, (err, tasks)=>{
                if(!err){
                    logger.debug(`Number of fixed urls: ${tasks.length}`);
                }
            });
        }
    };
    const taskRunner = {
        execute:function(){
            taskRegistry.getOneTask(function(err, task){
                if(err || !task){
                    return;
                }

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
                converter.searchParams.append(REQUEST_IDENTIFIER, "true");
                //this new url will contain our flag that prevents resolving in our middleware
                url = converter.toString().replace(urlBase, "");

                //executing the request

                server.makeLocalRequest("GET", url, "", {}, function (err, result) {
                    if (err) {
                        logger.error("caught an error during fetching fixedUrl", err.message, err.code, err);
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
                                logger.log("Not able to persist fixed url", task);
                            }

                            taskRegistry.markAsDone(task.url, (err) => {
                                if (err) {
                                    logger.log("May be not really important, but ... Not able to mark as done task ", task);
                                }
                            });

                            //let's test if we have other tasks that need to be executed...
                            taskRunner.execute();
                        });
                    }
                });
            })
        },
        pendingRequests:{},
        registerReq: function(url, req, res){
            if(!taskRunner.pendingRequests[url]){
                taskRunner.pendingRequests[url] = [];
            }
            taskRunner.pendingRequests[url].push({req, res});
        },
        resolvePendingReq: function(url, content){
            let pending = taskRunner.pendingRequests[url];
            if(!pending){
                return;
            }
            while(pending.length>0){
                let delayed = pending.shift();
                try{
                    respond(delayed.res, content);
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
        database = new LokiDatabase(databasePersistence, INTERVAL_TIME);

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

        if (req.query && req.query[REQUEST_IDENTIFIER]) {
            //this REQUEST_IDENTIFIER query param is set by our runner, and we should let this request to be executed
            return next();
        }

        //if we reached this line of code means that we need to do our "thing"
        let fixedUrl = ensureURLUniformity(req);
        if(taskRegistry.isInProgress(fixedUrl)){
            //there is a task for it... let's wait
            return taskRunner.registerReq(fixedUrl, req, res);
        }

        taskRegistry.isKnown(fixedUrl, (err, known) => {
            if (known) {
                //there is no task in progress for this url... let's test even more...
                return indexer.get(fixedUrl, (err, content) => {
                    if (err) {
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