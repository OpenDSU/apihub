let config = require("../../http-wrapper/config");
config = config.getConfig();

module.exports = function(server){
    server.use("*", function (req, res, next){
        let setHeader = res.setHeader;
        function setCacheHeader(res){
            // e.g. cacheDuration = [{urlPattern:"/assets/", duration: 3600, method: "startsWith"}]
            // urlPattern should be a string which should be matched by the selected method when trying to serve a specific url
            // duration should be a number and will be used to set the Cache Control value
            // method can be String.startsWith (default), String.endsWith,  RegExp.test
            let cacheDurations = config.cacheDurations || [];
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
                    case "equals":
                        fnc = function(urlPattern){
                            return  res.req.url === urlPattern;
                        }
                        break;
                    default:
                    // nothing...
                }

                if (fnc(urlPattern)) {
                    cacheDuration = duration || cacheDuration;
                    setHeader.call(res, 'Cache-Control', `public, max-age=${cacheDuration}`);
                    setHeader.call(res, 'X-Cache-Control-By', `CacheControlMiddleware`);
                    break;
                }
            }
        }
        res.setHeader = function(headerName, ...args){
            if(headerName.toLowerCase() === "cache-control"){
                setCacheHeader(res);
                return;
            }
            setHeader.call(res, headerName, ...args);
        }
        next();
    });
}