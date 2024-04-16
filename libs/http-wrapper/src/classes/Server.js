const MiddlewareRegistry = require('./MiddlewareRegistry');
const http = require('http');
const https = require('https');


function Server(sslOptions) {
    const middleware = new MiddlewareRegistry();
    const server = _initServer(sslOptions);


    this.use = function use(url, callback) {
        //TODO: find a better way
        if (arguments.length >= 2) {
            middleware.use(url, callback);
        } else if (arguments.length === 1) {
            callback = url;
            middleware.use(callback);
        }

    };

    this.get = function getReq(reqUrl, reqResolver) {
        middleware.use("GET", reqUrl, reqResolver);
    };

    this.post = function postReq(reqUrl, reqResolver) {
        middleware.use("POST", reqUrl, reqResolver);
    };

    this.put = function putReq(reqUrl, reqResolver) {
        middleware.use("PUT", reqUrl, reqResolver);
    };

    this.delete = function deleteReq(reqUrl, reqResolver) {
        middleware.use("DELETE", reqUrl, reqResolver);
    };

    this.options = function optionsReq(reqUrl, reqResolver) {
        middleware.use("OPTIONS", reqUrl, reqResolver);
    };

    this.head = function getReq(reqUrl, reqResolver) {
        middleware.use("HEAD", reqUrl, reqResolver);
    };

    this.getRegisteredMiddlewareFunctions = middleware.getRegisteredMiddlewareFunctions;

    this.makeLocalRequest = function (method, path, body, headers, callback) {
        if (typeof headers === "function") {
            callback = headers;
            headers = undefined;
        }

        if (typeof body === "function") {
            callback = body;
            headers = undefined;
            body = undefined;
        }

        const protocol = require(this.protocol);

        const options = {
            hostname: '127.0.0.1',
            port: server.address().port,
            path,
            method,
            headers
        };

        let timer = setTimeout(() => {
            let error = new Error("Forced timeout for local request");
            error.rootCause = "network";
            let cb = callback;
            callback = () => {
                console.warn("Canceled request still got a result");
            };
            cb(error);
        }, 1 * 60 * 1000)//after one minute

        const req = protocol.request(options, response => {
            if (timer) {
                clearTimeout(timer);
                timer = undefined;
            }

            if (response.statusCode < 200 || response.statusCode >= 300) {
                let err = new Error("Failed to execute command. StatusCode " + response.statusCode);
                err.httpCode = response.statusCode;
                return callback(err);
            }
            let data = [];
            response.on('data', chunk => {
                data.push(chunk);
            });

            response.on('end', () => {
                try {
                    const bodyContent = $$.Buffer.concat(data).toString();
                    //console.log('resolve will be called. bodyContent received : ', bodyContent);
                    return callback(undefined, bodyContent);
                } catch (err) {
                    return callback(err);
                }
            });
        });

        req.on('error', err => {
            return callback(err);
        });

        if (body) {
            req.write(body);
        }
        req.end();
    };

    this.makeLocalRequestAsync = async function (method, path, body, headers) {
        try {
            const makeLocalRequest = $$.promisify(this.makeLocalRequest.bind(this));
            let response = await makeLocalRequest(method, path, body, headers);

            if (response) {
                try {
                    response = JSON.parse(response);
                } catch (error) {
                    // the response isn't a JSON so we keep it as it is
                }
            }

            return response;
        } catch (error) {
            // console.warn(`Failed to call ${method} on '${path}'`, error);
            throw error;
        }
    }

    /* INTERNAL METHODS */

    function _initServer(sslConfig) {
        let server;
        if (sslConfig) {
            server = https.createServer(sslConfig, middleware.go);
            server.protocol = "https";
        } else {
            server = http.createServer(middleware.go);
            server.protocol = "http";
        }

        return server;
    }

    return new Proxy(this, {
        get(target, prop) {
            if (typeof target[prop] !== "undefined") {
                return target[prop];
            }

            if (typeof server[prop] === "function") {
                return function (...args) {
                    server[prop](...args);
                }
            } else {
                return server[prop];
            }
        },
        set(target, prop, value) {
            if (server.hasOwnProperty(prop)) {
                server[prop] = value;
                return true;
            }
            target[prop] = value;
            return true;
        }
    });
}

module.exports = Server;