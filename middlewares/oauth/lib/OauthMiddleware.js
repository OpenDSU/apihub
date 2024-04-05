const util = require("./util");
const urlModule = require("url");
const {httpUtils} = require("../../../libs/http-wrapper");
const {printDebugLog} = require("./util");

function OAuthMiddleware(server) {
    const logger = $$.getLogger("OAuthMiddleware", "apihub/oauth");

    function sendUnauthorizedResponse(req, res, reason, error) {
        logger.error(`[${req.method}] ${req.url} blocked: ${reason}`, error);
        res.statusCode = 403;
        const loginUrl = oauthConfig.client.postLogoutRedirectUrl;
        const returnHtml = "<html>" +
            `<body>We apologize for the inconvenience. The automated login attempt was unsuccessful. 
                    You can either <a href=\"${loginUrl}\">retry the login</a> or if the issue persists, please restart your browser.
                    <script>sessionStorage.setItem('initialURL', window.location.href);</script>
                </body>` +
            "</html>";
        res.end(returnHtml);
    }

    const LOADER_PATH = "/loader";
    logger.debug(`Registering OAuthMiddleware`);
    const staticContentIdentifiers = ["text/html", "application/xhtml+xml", "application/xml"];
    const config = require("../../../config");
    const oauthConfig = config.getConfig("oauthConfig");
    const path = require("path");
    const ENCRYPTION_KEYS_LOCATION = oauthConfig.encryptionKeysLocation || path.join(server.rootFolder, "external-volume", "encryption-keys");
    let urlsToSkip = util.getUrlsToSkip() ;

    const WebClient = require("./WebClient");
    const webClient = new WebClient(oauthConfig);
    const errorMessages = require("./errorMessages");

    const defaultUrlsToSkip = ["/installation-details", "/ready-probe"];
    urlsToSkip = urlsToSkip.concat(defaultUrlsToSkip);
    const defaultActionsToSkip = ["brick-exists", "get-all-versions", "get-last-version", "get-brick", "credential"];

    //we let KeyManager to boot and prepare ...
    util.initializeKeyManager(ENCRYPTION_KEYS_LOCATION, oauthConfig.keyTTL);

    function redirectToLogin(req, res) {
        res.statusCode = 200;
        res.write(`<html><body><script>sessionStorage.setItem('initialURL', window.location.href); window.location.href = "/login";</script></body></html>`);
        res.end();
    }

    function setSSODetectedId(ssoDetectedId, SSOUserId, accessTokenCookie, req, res) {
        res.writeHead(200, {'Content-Type': 'text/html'});
        return res.end(`<script>localStorage.setItem('SSODetectedId', '${ssoDetectedId}'); localStorage.setItem('SSOUserId', '${SSOUserId}'); localStorage.setItem('accessTokenCookie', '${accessTokenCookie}');window.location.href = '/redirect.html';</script>`);
    }

    function startAuthFlow(req, res) {
        util.printDebugLog("Starting authentication flow");
        const loginContext = webClient.getLoginInfo(oauthConfig);
        util.printDebugLog("Login info", JSON.stringify(loginContext));
        util.encryptLoginInfo(loginContext, (err, encryptedContext) => {
            if (err) {
                return sendUnauthorizedResponse(req, res, "Unable to encrypt login info");
            }
            let cookies = [`loginContextCookie=${encryptedContext}; Path=/; HttpOnly; Secure`];
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
                            Location: "/setSSODetectedId",
                            "Set-Cookie": [`logout=false; Path=/; HttpOnly; Secure`, `accessTokenCookie=${encryptedTokenSet.encryptedAccessToken}; Max-age=86400; HttpOnly; Secure`, "isActiveSession=true; Max-age=86400; HttpOnly; Secure", `refreshTokenCookie=${encryptedTokenSet.encryptedRefreshToken}; Max-age=86400; HttpOnly; Secure`, `SSOUserId=${SSOUserId}; Max-age=86400; HttpOnly; Secure`, `SSODetectedId=${SSODetectedId}; Max-age=86400; HttpOnly; Secure`, `loginContextCookie=; Max-Age=0; Path=/; HttpOnly; Secure`],
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

        let cookies = ["logout=true; Path=/; HttpOnly; Secure", "accessTokenCookie=; Max-Age=0; HttpOnly; Secure", "isActiveSession=; Max-Age=0; HttpOnly; Secure", "refreshTokenCookie=; Max-Age=0; HttpOnly; Secure", "loginContextCookie=; Path=/; HttpOnly; Secure; Max-Age=0", `logoutUrl=${logoutUrl.href}; Path=/; HttpOnly; Secure`, `postLogoutRedirectUrl=${oauthConfig.client.postLogoutRedirectUrl}; Path=/; HttpOnly; Secure`];
        logger.info("SSO redirect (http 301) triggered for:", req.url);
        if (oauthConfig.usePostForLogout) {
            res.writeHead(301, {
                Location: "/logout-post",
                "Set-Cookie": cookies,
                "Cache-Control": "no-store, no-cache, must-revalidate, post-check=0, pre-check=0"
            });

            return res.end();
        }

        res.writeHead(301, {
            Location: urlModule.format(logoutUrl),
            "Set-Cookie": cookies,
            "Cache-Control": "no-store, no-cache, must-revalidate, post-check=0, pre-check=0"
        });
        res.end();
    }

    const CHECK_IF_SESSION_HAS_EXPIRED = "/checkIfSessionHasExpired";
    const LOGOUT_WAS_TRIGGERED = "/logoutWasTriggered";
    server.use(function (req, res, next) {
        let {url} = req;

        if (url === CHECK_IF_SESSION_HAS_EXPIRED) {
            const {sessionExpiryTime} = util.parseCookies(req.headers.cookie);
            res.statusCode = 200;
            if (sessionExpiryTime && parseInt(sessionExpiryTime) < Date.now()) {
                return res.end("true");
            }
            return res.end("false");
        }

        if (url === LOGOUT_WAS_TRIGGERED) {
            const {logout} = util.parseCookies(req.headers.cookie);
            res.statusCode = 200;
            return res.end(logout);
        }

        function isSetSSODetectedIdPhaseActive() {
            return url === "/setSSODetectedId";
        }

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
            let cookies = ["accessTokenCookie=; Max-Age=0; HttpOnly; Secure", "isActiveSession=; Max-Age=0; HttpOnly; Secure", "refreshTokenCookie=; Max-Age=0; HttpOnly; Secure", "loginContextCookie=; Path=/; Max-Age=0; HttpOnly; Secure"];
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

        function isLogoutPostPhaseActive() {
            return url === "/logout-post";
        }


        if (req.skipSSO) {
            return next();
        }

        const canSkipOAuth = urlsToSkip.some((urlToSkip) => url.indexOf(urlToSkip) === 0);
        if (canSkipOAuth) {
            next();
            return;
        }

        let urlParts = url.split("/");
        let action = "";
        try {
            action = urlParts[3];
        } catch (err) {
            //ignored on purpose
        }

        if (defaultActionsToSkip.indexOf(action) !== -1) {
            next();
            return;
        }

        //this if is meant to help debugging "special" situation of wrong localhost req being checked with sso even if localhostAuthorization is disabled
        if (!config.getConfig("enableLocalhostAuthorization") && req.headers.host.indexOf("localhost") !== -1) {
            printDebugLog("SSO verification activated on 'local' request", "host header", req.headers.host, JSON.stringify(req.headers));
        }

        if (isCallbackPhaseActive()) {
            return loginCallbackRoute(req, res);
        }

        if (isLogoutPhaseActive()) {
            return logout(req, res);
        }

        if (isLoginPhaseActive()) {
            return startAuthFlow(req, res);
        }

        const parsedCookies = util.parseCookies(req.headers.cookie);
        let {accessTokenCookie, refreshTokenCookie, isActiveSession, SSODetectedId, SSOUserId} = parsedCookies;
        if (isSetSSODetectedIdPhaseActive()) {
            return setSSODetectedId(SSODetectedId, SSOUserId, accessTokenCookie, req, res);
        }
        let logoutCookie = parsedCookies.logout;
        let cookies = [];

        if (isPostLogoutPhaseActive()) {
            return startAuthFlow(req, res);
        }

        if (isLogoutPostPhaseActive()) {
            const returnHtml = "<html>" +
                `<body>
                 <script>
                    function parseCookies(cookies) {
                        const parsedCookies = {};
                        if (!cookies) {
                            return parsedCookies;
                        }
                        let splitCookies = cookies.split(";");
                        splitCookies = splitCookies.map(splitCookie => splitCookie.trim());
                        splitCookies.forEach(cookie => {
                            const cookieComponents = cookie.split("=");
                            const cookieName = cookieComponents[0].trim();
                            let cookieValue = cookieComponents[1].trim();
                            if (cookieValue === "null") {
                                cookieValue = undefined;
                            }
                            parsedCookies[cookieName] = cookieValue;
                        })
                    
                        return parsedCookies;
                    }

                    const parsedCookies = parseCookies(document.cookie);
                    const logoutUrl = parsedCookies.logoutUrl;
                    const postLogoutRedirectUrl = parsedCookies.postLogoutRedirectUrl;
                    
                    fetch(logoutUrl, {method: "POST"}).
                        then(response => {
                            window.location.href = postLogoutRedirectUrl; 
                        })
                 </script>
                </body>` +
                "</html>";

            return res.end(returnHtml);
        }

        if (logoutCookie === "true") {
            res.statusCode = 403;
            const loginUrl = oauthConfig.client.postLogoutRedirectUrl;
            const returnHtml = "<html>" +
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
                if (req.headers && req.headers.accept) {
                    const acceptHeadersIdentifiers = req.headers.accept.split(",");
                    if (acceptHeadersIdentifiers.some((acceptHeader) => staticContentIdentifiers.includes(acceptHeader))) {
                        return redirectToLogin(req, res);
                    }
                }
                res.statusCode = 401;
                return res.end("Unauthorized");
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

                    cookies = cookies.concat([`accessTokenCookie=${tokenSet.encryptedAccessToken}; Max-age=86400; HttpOnly; Secure`, `refreshTokenCookie=${tokenSet.encryptedRefreshToken}; HttpOnly; Secure`]);
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
                    cookies = cookies.concat([`sessionExpiryTime=${sessionExpiryTime}; Path=/; HttpOnly; Secure`, `accessTokenCookie=${encryptedAccessToken}; Path=/; Max-age=86400; HttpOnly; Secure`]);
                    res.setHeader("Set-Cookie", cookies);
                    next();
                })
            })
        })
    });

    const GET_USER_ID = "/clientAuthenticationProxy/getUserId";
    server.post(GET_USER_ID, httpUtils.bodyParser);
    server.post(GET_USER_ID, async (req, res) => {
        try {
            req.body = JSON.parse(req.body);
        } catch (e) {
            res.statusCode = 400;
            res.end("Invalid request body");
            return;
        }
        const {clientId, clientSecret, scope, tokenEndpoint} = req.body;

        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);
        params.append('scope', scope);

        let response;
        try {
            response = await fetch(tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: params
            })
        } catch (e) {
            res.statusCode = 500;
            res.end(e.message);
            return;
        }
        if (response.status !== 200) {
            res.statusCode = response.status;
            res.end(response.statusText);
            return;
        }
        let data;
        try {
            data = await response.json();
        } catch (e) {
            res.statusCode = 500;
            res.end(e.message);
            return;
        }
        const {payload} = util.parseAccessToken(data.access_token);
        res.statusCode = 200;
        res.end(payload.sub);
    })
}

module.exports = OAuthMiddleware;
