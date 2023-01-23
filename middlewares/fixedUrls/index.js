module.exports = function(server){

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

    function getFsHandler(rootFolder){
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

    taskRegistry.markTaskDone = function(base64serializedUrl, callback){
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
    let intervalTracker;
    const taskRunner = {
        inProgress:{},
        registerReq : function(fixedUrl, req, res){
            if(!pendingRequests[fixedUrl]){
                pendingRequests[fixedUrl] = [];
            }
            pendingRequests[fixedUrl].push({req, res});
        },
        executeTask : function(){
            //todo: what happens if the interval is quicker the task resolving...?!
            taskRegistry.getNextTask((err, task)=>{
                let fixedUrl = new Buffer(task, 'base64').toString('ascii');
                taskRunner.inProgress[task] = fixedUrl;

                //we need to do the request and save the result into the cache

                //after storing into to cache we need to check if there are other pending requests for the same fixurl

            });
        }
    }

    intervalTracker = setInterval(taskRunner.executeTask, 10*60*1000);

    const fixedUrlCache = {
        set: function(fixedUrl, content, callback){
            let filename = path.join(cacheDir, fixedUrl);
            fs.writeFile(filename, content, callback);
        },
        get: function(fixedUrl, callback){
            let filename = path.join(cacheDir, fixedUrl);
            fs.readFile(filename, callback);
        }
    }

    server.put("/registerFixedUrl/:relativeUrlBase64", function(req, res){
        taskRegistry.registerUrl(req.params.relativeUrlBase64, (err)=>{
            if(err){
                console.log("Caught an error during registration of a fixedUrl", err);
                res.statusCode = 500;
            }
            res.statusCode = 200;
            return res.end();
        });
    });

    server.put("/unregisterFixedUrl/:relativeUrlBase64", function(req, res){
        taskRegistry.unregisterUrl(req.params.relativeUrlBase64, (err)=>{
            if(err){
                //we can ignore all the errors during unregister
            }
            res.statusCode = 200;
            return res.end();
        });
    });

    server.use("*", function(req, res, next){
        if(req.method !== "GET" || !req.query || req.params.query.fixedurlrequest){
            //if we don't have any query params, or we have but is marked that is one generated from us
            return next();
        }

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
                    res.write(content);
                    res.statusCode = 200;
                    res.headers["cache-control"] = `max-age=${10*60}`;
                    res.end();
                });
            }
            //there is a task for it... let's wait for the resolve
            taskRunner.registerReq(fixedUrl, req, res);
        });
    });
}