const REQUEST_IDENTIFIER = "fixedurlrequest";
const INTERVAL_TIME = 5*1000; //ms aka 5 sec
const DEFAULT_MAX_AGE = 10*60; //seconds aka 10 minutes

module.exports = function(server){

    let watchedUrls = [];
    //we inject a helper function that can be called by different components or middleware to signal that their requests
    // can be watched by us
    server.fixedUrlWatchUrl = function(url){
        if(!url){
            throw new Error("Expected an Array of strings or single string representing url prefix");
        }
        if(Array.isArray(url)){
            watchedUrls = watchedUrls.concat(url);
            return;
        }
        watchedUrls.push(url);
    }

    function createBase64UrlSignature(req){
        let base = "https://non.relevant.url.com";
        //we add the base to get a valid url
        let converter = new URL(base+req.url);
        //we ensure that the searchParams are sorted
        converter.searchParams.sort();
        //we remove our artificial base
        let newString = converter.toString().replaceAll(base, "");
        let base64 = Buffer.from(newString).toString("base64");
        return base64;
    }

    let fsname = "fs";
    const fs = require(fsname);
    let pathname = "path";
    const path = require(pathname);

    const workingDir = path.join(server.rootFolder, "external-volume", "fixed-urls");
    const tasksDir = path.join(workingDir, "tasks");
    const cacheDir = path.join(workingDir, "cache");
    const registryDir = path.join(workingDir, "registry");

    function writeFixedUrlContent(res, content){
        res.write(content);
        res.statusCode = 200;
        const fixedURLExpiry = server.config.fixedURLExpiry || DEFAULT_MAX_AGE;
        res.setHeader("cache-control", `max-age=${fixedURLExpiry}`);
        res.end();
    }

    function getFsHandler(rootFolder){
        fs.mkdir(rootFolder, {recursive: true}, (err)=>{
           if(err){
               console.log("Failed to ensure folder structure due to", err);
           }
        });
        return {
            rootFolder: rootFolder,
            registerUrl:function(base64serializedUrl, callback){
                let filename = path.join(rootFolder, base64serializedUrl);
                fs.writeFile(filename, "", callback);
            },
            unregisterUrl:function(base64serializedUrl, callback){
                let filename = path.join(rootFolder, base64serializedUrl);
                fs.unlink(filename, callback);
            },
            alreadyExists:function(base64serializedUrl, callback){
                let filename = path.join(rootFolder, base64serializedUrl);
                fs.readFile(filename, (err)=>{
                    callback(err, !err);
                });
            }
        }
    }

    const taskRegistry = getFsHandler(tasksDir);

    taskRegistry.markTaskAsDone = function(base64serializedUrl, callback){
        taskRegistry.unregisterUrl(base64serializedUrl, callback);
    };

    taskRegistry.getNextTask=function(callback){
        fs.readdir(taskRegistry.rootFolder, (err, files)=>{
            if(err){
                return callback(err);
            }
            let nextAvailableTask = files.length > 0 ? files[0] : undefined;
            callback(undefined, nextAvailableTask);
        });
    };

    const registryHandler = getFsHandler(registryDir);

    let pendingRequests = {};
    const taskRunner = {
        inProgress:{},
        getTask : function(callback){
            if(Object.keys(taskRunner.inProgress).length > 0){
                //the interval got executed faster than we finished the current task
                return;
            }
            taskRegistry.getNextTask((err, task)=>{
                if(err){
                    //let's try again
                    return taskRunner.getTask(callback);
                }
                if(!task){
                    //we need to do anything when no task available
                    return;
                }
                let fixedUrl = Buffer.from(task, 'base64').toString('ascii');
                taskRunner.inProgress[task] = fixedUrl;
                return callback(undefined, task);
            });
        },
        removePendingTask : function(fixedUrl, callback){
            if(this.inProgress[fixedUrl]){
                this.inProgress[fixedUrl] = undefined;
                delete this.inProgress[fixedUrl];
            }
            //todo: it is oky to cancel requests that are waiting for the content ???
            /*if(pendingRequests[fixedUrl]){
                pendingRequests[fixedUrl] = [];
            }*/

            callback(undefined, true);
        },
        registerReq : function(fixedUrl, req, res){
            if(!pendingRequests[fixedUrl]){
                pendingRequests[fixedUrl] = [];
            }
            pendingRequests[fixedUrl].push({req, res});
        },
        executeTask : function(){
            //todo: what happens if the interval is quicker the task resolving...?!
            taskRunner.getTask((err, task)=>{
                let fixedUrl = taskRunner.inProgress[task];

                //we need to do the request and save the result into the cache
                let urlBase = `http://localhost`
                let url = urlBase;
                if(!fixedUrl.startsWith("/")){
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
                server.makeLocalRequest("GET", url, "", {}, function(err, result){
                    if(err){
                        taskRunner.inProgress[task] = undefined;
                        delete taskRunner.inProgress[task];
                        return taskRegistry.unregisterUrl(task, (err)=>{
                            if(err){
                                console.log("Failed to remove a task that we weren't able to resolve");
                            }
                        });
                    }
                    //got result... we need to store it for future requests, and we need to resolve any pending request waiting for it
                    if(result){

                        //let's resolve as fast as possible any pending request for the current task
                        let pendingList = pendingRequests[task];
                        if(pendingList){
                            for(let index of pendingList){
                                let pending = pendingList[index];
                                try{
                                    writeFixedUrlContent(pending.res, result);
                                }catch(err){
                                    //we ignore any errors that we may get due to timeouts or any reason
                                }
                            }
                        }

                        if(!taskRunner.inProgress[task]){
                            //it means that the task was removed before we were able to resolve it
                            return;
                        }

                        taskRegistry.markTaskAsDone(task, (err)=>{
                            if(err){
                                console.log("May be not really important, but ... Not able to mark as done task ", task);
                            }
                        });

                        fixedUrlCache.set(task, result, function (err){
                            if(err){
                                console.log("Not able to persist fixed url", task);
                            }

                            taskRunner.inProgress[task] = undefined;
                            delete taskRunner.inProgress[task];
                            //let's test if we have other tasks that need to be executed...
                            taskRunner.executeTask();
                        });
                    }
                });


            });
        }
    }

    setInterval(taskRunner.executeTask, INTERVAL_TIME);

    fs.mkdir(cacheDir, {recursive: true}, (err)=>{
        if(err){
            console.log("Failed to ensure folder structure due to", err);
        }
    });
    const fixedUrlCache = {
        getFileName: function(fixedUrl){
            return path.join(cacheDir, fixedUrl);
        },
        set: function(fixedUrl, content, callback){
            registryHandler.registerUrl(fixedUrl, (err)=>{
                if(err){
                    console.log("Failed to add fixedUrl to registryHandler", err);
                }

                fs.writeFile(this.getFileName(fixedUrl), content, callback);
            });
        },
        get: function(fixedUrl, callback){
            fs.readFile(this.getFileName(fixedUrl), callback);
        },
        remove: function(fixedUrl, callback){
            fs.unlink(this.getFileName(fixedUrl), callback);
        }
    }

    server.put("/registerFixedUrl/:relativeUrlBase64", function(req, res){
        taskRegistry.registerUrl(req.params.relativeUrlBase64, (err)=>{
            res.statusCode = 200;
            if(err){
                console.log("Caught an error during registration of a fixedUrl", err);
                res.statusCode = 500;
            }
            return res.end();
        });
    });

    server.put("/unregisterFixedUrl/:relativeUrlBase64", function(req, res){
        const task = req.params.relativeUrlBase64;
        taskRunner.removePendingTask(task, (err)=>{
            if(err){
                //we can ignore all the errors during unregister
            }
            //first we remove eventual task that may be in progress or waiting to be executed
            taskRegistry.unregisterUrl(task, (err)=>{
                if(err){
                    //we can ignore all the errors during unregister
                }
                //we remove any fixed url cache
                fixedUrlCache.remove(task, (err)=>{
                    if(err){
                        //we can ignore all the errors during unregister
                    }
                    //we clear the registry
                    registryHandler.unregisterUrl(task, (err)=>{
                        if(err){
                            //we can ignore all the errors during unregister
                        }
                        res.statusCode = 200;
                        return res.end();
                    });
                });
            });
        });
    });

    //register a middleware to intercept all the requests
    server.use("*", function(req, res, next){

        if(req.method !== "GET" ){
            //not our responsibility... for the moment we resolve only GET methods that have query params...
            return next();
        }

        let possibleFixedUrl = false;
        for(let url of watchedUrls){
            if(req.url.startsWith(url)){
                possibleFixedUrl = true;
            }
        }

        if(!possibleFixedUrl){
            //not our responsibility
            return next();
        }

        if(req.query && req.query[REQUEST_IDENTIFIER]){
            //this REQUEST_IDENTIFIER query param is set by our runner, and we should let this request to be executed
            return next();
        }


        //if we reached this line of code means that we need to do our "thing"
        let fixedUrl = createBase64UrlSignature(req);
        taskRegistry.alreadyExists(fixedUrl, (err, known)=>{
            if(!known){
                //there is no task in progress for this url... let's test even more...
                return fixedUrlCache.get(fixedUrl, (err, content)=>{
                    if(err){
                        //no current task and no cache... let's move on to resolving the req
                        return next();
                    }
                    //known fixed url let's write to the client
                    writeFixedUrlContent(res, content);
                });
            }
            //there is a task for it... let's wait
            taskRunner.registerReq(fixedUrl, req, res);
        });
    });
}