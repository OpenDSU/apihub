let path = "path";
path = require(path);
let fs = "fs";
fs = require(fs);

let readOnly = false;

module.exports = function(server){
  let config = server.config;
  let readOnlyFlag = config.readOnlyFile || "readonly";
  let interval  = config.readOnlyInterval || 60*1000;
  let rootStorage = path.resolve(config.storage);
  readOnlyFlag = path.resolve(rootStorage, readOnlyFlag);

  if(readOnlyFlag.indexOf(rootStorage) === -1){
    console.warn(`ReadOnly flag location resolved outside of ApiHUB root folder. (${readOnlyFlag})`);
  }

  function checkReadOnlyFlag(){
    fs.access(readOnlyFlag, fs.constants.F_OK, (err) => {
      if(!err){
        if(!readOnly){
          console.info("Read only mode is activated.");
          readOnly = true;
        }
      }else{
        if(readOnly){
          console.info("Read only mode is disabled.");
          readOnly = false;
        }
      }
    });
  }

  checkReadOnlyFlag();
  setInterval(checkReadOnlyFlag, interval);

  server.use("*", function(req, res, next){
    if(readOnly && req.method !== "GET"){
      res.statusCode = 405;
      res.write("read only mode is active");
      return res.end();
    }
    next();
  });
}