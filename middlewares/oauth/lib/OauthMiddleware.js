const {sendUnauthorizedResponse} = require("../../../utils/middlewares");
const util = require("./util");
const urlModule = require("url");

function OAuthMiddleware(server) {
    const logger = $$.getLogger("OAuthMiddleware", "apihub/oauth");
    const LOADER_PATH = "/loader";
    logger.debug(`Registering OAuthMiddleware`);
    const config = require("../../../config");
    const oauthConfig = config.getConfig("oauthConfig");
    const path = require("path");
    const ENCRYPTION_KEYS_LOCATION = oauthConfig.encryptionKeysLocation || path.join(server.rootFolder, "external-volume", "encryption-keys");
    const urlsToSkip = util.getUrlsToSkip();

    const WebClient = require("./WebClient");
    const webClient = new WebClient(oauthConfig);
    const errorMessages = require("./errorMessages");

    const defaultUrlsToSkip = ["brick-exists", "get-all-versions", "get-last-version", "get-brick", "credential"];
    
    //we let KeyManager to boot and prepare ...
    util.initializeKeyManager(ENCRYPTION_KEYS_LOCATION, oauthConfig.keyTTL);

    function redirectToLogin(req, res) {
        res.statusCode = 200;
        res.write(`<html><body><script>sessionStorage.setItem('initialURL', window.location.href); window.location.href = "/login";</script></body></html>`);
        res.end();
    }
    function startAuthFlow(req, res) {
        util.printDebugLog("Starting authentication flow");
        const loginContext = webClient.getLoginInfo(oauthConfig);
        util.printDebugLog("Login info", JSON.stringify(loginContext));
        util.encryptLoginInfo(loginContext, (err, encryptedContext) => {
            if (err) {
                return sendUnauthorizedResponse(req, res, "Unable to encrypt login info");
            }
            let cookies = [`loginContextCookie=${encryptedContext}; Path=/`];
            logger.info("SSO redirect (http 301) triggered for:", req.url);
            res.writeHead(301, {
                Location: loginContext.redirect,
                "Set-Cookie": cookies,
                "Cache-Control": "no-store, no-cache, must-revalidate, post-check=0, pre-check=0"
            });
            res.end();
        })
    }

    function loginCallbackRoute(req, res) {
        util.printDebugLog("Entered login callback");
        let cbUrl = req.url;
        let query = urlModule.parse(cbUrl, true).query;
        const {loginContextCookie} = util.parseCookies(req.headers.cookie);
        if (!loginContextCookie) {
            util.printDebugLog("Logout because loginContextCookie is missing.")
            return logout(req, res);
        }
        util.decryptLoginInfo(loginContextCookie, (err, loginContext) => {
            if (err) {
                return sendUnauthorizedResponse(req, res, "Unable to decrypt login info", err);
            }

            if (Date.now() - loginContext.date > oauthConfig.sessionTimeout) {
                util.printDebugLog("Logout because loginContextCookie is expired.")
                return logout(req, res);
            }

            const queryCode = query['code'];
            const queryState = query['state'];
            const context = {
                clientState: loginContext.state,
                clientFingerprint: loginContext.fingerprint,
                clientCode: loginContext.codeVerifier,
                queryCode,
                queryState,
                origin: req.headers.host,
            };

            util.printDebugLog("Requesting token set");
            util.printDebugLog("context", JSON.stringify(context));
            webClient.loginCallback(context, (err, tokenSet) => {
                if (err) {
                    return sendUnauthorizedResponse(req, res, "Unable to get token set", err);
                }

                util.printDebugLog("Access token", tokenSet.access_token);
                util.printDebugLog("Id token", tokenSet.id_token);
                util.encryptTokenSet(tokenSet, (err, encryptedTokenSet) => {
                    if (err) {
                        return sendUnauthorizedResponse(req, res, "Unable to encrypt access token", err);
                    }
                    util.getSSODetectedIdAndUserId(tokenSet, (err, {SSODetectedId, SSOUserId}) => {
                        if (err) {
                            util.printDebugLog("Unable to get SSODetectedId");
                            return sendUnauthorizedResponse(req, res, "Unable to get token set", err);
                        }

                        util.printDebugLog("SSODetectedId", SSODetectedId);
                        res.writeHead(301, {
                            Location: "/redirect.html",
                            "Set-Cookie": [`logout=false; Path=/`, `accessTokenCookie=${encryptedTokenSet.encryptedAccessToken}; Max-age=${86400}`, "isActiveSession=true", `refreshTokenCookie=${encryptedTokenSet.encryptedRefreshToken}`, `SSOUserId = ${SSOUserId}`, `SSODetectedId = ${SSODetectedId}`, `loginContextCookie=; Max-Age=0; Path=/`],
                            "Cache-Control": "no-store, no-cache, must-revalidate, post-check=0, pre-check=0"
                        });
                        res.end();
                    });
                })
            });
        });
    }

    function logout(req, res) {
        const urlModule = require("url");
        const logoutUrl = urlModule.parse(oauthConfig.client.logoutUrl);

        logoutUrl.query = {
            post_logout_redirect_uri: oauthConfig.client.postLogoutRedirectUrl, client_id: oauthConfig.client.clientId,
        };

        let cookies = ["logout=true; Path=/;", "accessTokenCookie=; Max-Age=0", "isActiveSession=; Max-Age=0", "refreshTokenCookie=; Max-Age=0", "loginContextCookie=; Path=/; Max-Age=0"];
        logger.info("SSO redirect (http 301) triggered for:", req.url);
        res.writeHead(301, {
            Location: urlModule.format(logoutUrl),
            "Set-Cookie": cookies,
            "Cache-Control": "no-store, no-cache, must-revalidate, post-check=0, pre-check=0"
        });
        res.end();
    }

    server.use(function (req, res, next) {
        let {url} = req;

        function isCallbackPhaseActive() {
            const redirectUrlObj = new urlModule.URL(oauthConfig.client.redirectPath);
            const redirectPath = oauthConfig.client.redirectPath.slice(redirectUrlObj.origin.length);
            return !!url.includes(redirectPath) || !!url.includes("code=");
        }

        function isPostLogoutPhaseActive() {
            const postLogoutRedirectUrlObj = new urlModule.URL(oauthConfig.client.postLogoutRedirectUrl);
            const postLogoutRedirectPath = oauthConfig.client.postLogoutRedirectUrl.slice(postLogoutRedirectUrlObj.origin.length);
            return !!url.includes(postLogoutRedirectPath);
        }

        function startLogoutPhase(res) {
            let cookies = ["accessTokenCookie=; Max-Age=0", "isActiveSession=; Max-Age=0", "refreshTokenCookie=; Max-Age=0", "loginContextCookie=; Path=/; Max-Age=0"];
            logger.info("SSO redirect (http 301) triggered for:", req.url);
            res.writeHead(301, {
                Location: "/logout",
                "Set-Cookie": cookies,
                "Cache-Control": "no-store, no-cache, must-revalidate, post-check=0, pre-check=0"
            });
            res.end();
        }

        function isLogoutPhaseActive() {
            return url === "/logout";
        }

        function isLoginPhaseActive() {
            return url === "/login";
        }

        const canSkipOAuth = urlsToSkip.some((urlToSkip) => url.indexOf(urlToSkip) === 0);
        if (canSkipOAuth) {
            next();
            return;
        }

        let urlParts = url.split("/");
        let action = "";
        try{
            action = urlParts[3];
        }
         catch(err){
             //ignored on purpose
         }
            
        if(defaultUrlsToSkip.indexOf(action) !== -1) {
            next();
            return;
        }
        
        if (!config.getConfig("enableLocalhostAuthorization") && req.headers.host.indexOf("localhost") === 0) {
            next();
            return;
        }

        //this if is meant to help debugging "special" situation of wrong localhost req being checked with sso even if localhostAuthorization is disabled
        if (!config.getConfig("enableLocalhostAuthorization") && req.headers.host.indexOf("localhost") !== -1) {
            logger.debug("SSO verification activated on 'local' request", "host header", req.headers.headers.host, JSON.stringify(req.headers));
        }

        if (isCallbackPhaseActive()) {
            return loginCallbackRoute(req, res);
        }

        if (isLogoutPhaseActive()) {
            return logout(req, res);
        }

        if(isLoginPhaseActive()){
            return startAuthFlow(req, res);
        }

        const parsedCookies = util.parseCookies(req.headers.cookie);
        let {accessTokenCookie, refreshTokenCookie, isActiveSession} = parsedCookies;
        let logoutCookie = parsedCookies.logout;
        let cookies = [];

        if (isPostLogoutPhaseActive()) {
            return startAuthFlow(req, res);
        }

        if(logoutCookie === "true"){
            res.statusCode = 403;
            const loginUrl = oauthConfig.client.postLogoutRedirectUrl;
            const returnHtml ="<html>" +
              `<body>We apologize for the inconvenience. The automated login attempt was unsuccessful. 
                    You can either <a href=\"${loginUrl}\">retry the login</a> or if the issue persists, please restart your browser.
                    <script>sessionStorage.setItem('initialURL', window.location.href);</script>
                </body>` +
              "</html>";

            return res.end(returnHtml);
        }

        if (!accessTokenCookie) {
            if (!isActiveSession) {
                util.printDebugLog("Redirect to login because accessTokenCookie and isActiveSession are missing.")
                return redirectToLogin(req, res);
            } else {
                util.printDebugLog("Logout because accessTokenCookie is missing and isActiveSession is present.")
                return startLogoutPhase(res);
            }
        }

        const jwksEndpoint = config.getConfig("oauthJWKSEndpoint");
        util.validateEncryptedAccessToken(jwksEndpoint, accessTokenCookie, oauthConfig.sessionTimeout, (err) => {
            if (err) {
                if (err.message === errorMessages.ACCESS_TOKEN_DECRYPTION_FAILED || err.message === errorMessages.SESSION_EXPIRED) {
                    util.printDebugLog("Logout because accessTokenCookie decryption failed or session has expired.")
                    return startLogoutPhase(res);
                }

                return webClient.refreshToken(refreshTokenCookie, (err, tokenSet) => {
                    if (err) {
                        if (err.message === errorMessages.REFRESH_TOKEN_DECRYPTION_FAILED || err.message === errorMessages.SESSION_EXPIRED) {
                            util.printDebugLog("Logout because refreshTokenCookie decryption failed or session has expired.")
                            return startLogoutPhase(res);
                        }
                        return sendUnauthorizedResponse(req, res, "Unable to refresh token");
                    }

                    cookies = cookies.concat([`accessTokenCookie=${tokenSet.encryptedAccessToken}; Max-age=${86400}`, `refreshTokenCookie=${tokenSet.encryptedRefreshToken}`]);
                    logger.info("SSO redirect (http 301) triggered for:", req.url);
                    res.writeHead(301, {Location: "/", "Set-Cookie": cookies});
                    res.end();
                })
            }

            util.getSSODetectedIdFromEncryptedToken(accessTokenCookie, (err, SSODetectedId) => {
                if (err) {
                    util.printDebugLog("Logout because accessTokenCookie decryption failed or session has expired.")
                    return startLogoutPhase(res);
                }

                util.printDebugLog("SSODetectedId", SSODetectedId);
                req.headers["user-id"] = SSODetectedId;
                if (url.includes("/mq/")) {
                    return next();
                }
                util.updateAccessTokenExpiration(accessTokenCookie, (err, encryptedAccessToken) => {
                    if (err) {
                        util.printDebugLog("Logout because accessTokenCookie decryption failed.")
                        return startLogoutPhase(res);
                    }

                    const sessionExpiryTime = Date.now() + oauthConfig.sessionTimeout;
                    cookies = cookies.concat([`sessionExpiryTime=${sessionExpiryTime}; Path=/`, `accessTokenCookie=${encryptedAccessToken}; Path=/; Max-age=${86400}`]);
                    res.setHeader("Set-Cookie", cookies);
                    next();
                })
            })
        })
    });
}

module.exports = OAuthMiddleware;
