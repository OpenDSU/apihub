const {sendUnauthorizedResponse} = require("../../../utils/middlewares");
const util = require("./util");
const urlModule = require("url");

function OAuthMiddleware(server) {
  const logger = $$.getLogger("OAuthMiddleware", "apihub/oauth");

  logger.debug(`Registering OAuthMiddleware`);
  const config = require("../../../config");
  const oauthConfig = config.getConfig("oauthConfig");
  const path = require("path");
  const ENCRYPTION_KEYS_LOCATION = oauthConfig.encryptionKeysLocation || path.join(server.rootFolder, "external-volume", "encryption-keys");
  const urlsToSkip = util.getUrlsToSkip();

  const WebClient = require("./WebClient");
  const webClient = new WebClient(oauthConfig);
  const errorMessages = require("./errorMessages");

  //we let KeyManager to boot and prepare ...
  util.initializeKeyManager(ENCRYPTION_KEYS_LOCATION, oauthConfig.keyTTL);

  function startAuthFlow(req, res) {
    printDebugLog("Starting authentication flow");
    const loginContext = webClient.getLoginInfo(oauthConfig);
    printDebugLog("Login info", JSON.stringify(loginContext));
    util.encryptLoginInfo(loginContext, (err, encryptedContext) => {
      if (err) {
        return sendUnauthorizedResponse(req, res, "Unable to encrypt login info");
      }

      res.writeHead(301, {
        Location: loginContext.redirect,
        "Set-Cookie": `loginContextCookie=${encryptedContext}`,
        "Cache-Control": "no-store, no-cache, must-revalidate, post-check=0, pre-check=0"
      });
      res.end();
    })
  }

  function loginCallbackRoute(req, res) {
    printDebugLog("Entered login callback");
    let cbUrl = req.url;
    let query = urlModule.parse(cbUrl, true).query;
    const {loginContextCookie} = util.parseCookies(req.headers.cookie);
    if (!loginContextCookie) {
      printDebugLog("Logout because loginContextCookie is missing.")
      return logout(res);
    }
    util.decryptLoginInfo(loginContextCookie, (err, loginContext) => {
      if (err) {
        return sendUnauthorizedResponse(req, res, "Unable to decrypt login info", err);
      }

      if (Date.now() - loginContext.date > oauthConfig.sessionTimeout) {
        printDebugLog("Logout because loginContextCookie is expired.")
        return logout(res);
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

      printDebugLog("Requesting token set");
      printDebugLog("context", JSON.stringify(context));
      webClient.loginCallback(context, (err, tokenSet) => {
        if (err) {
          return sendUnauthorizedResponse(req, res, "Unable to get token set", err);
        }

        printDebugLog("Access token", tokenSet.access_token);
        util.encryptTokenSet(tokenSet, (err, encryptedTokenSet) => {
          if (err) {
            return sendUnauthorizedResponse(req, res, "Unable to encrypt access token", err);
          }

          const {payload} = util.parseAccessToken(tokenSet.access_token);
          printDebugLog("Access token payload", payload);
          const SSODetectedId = util.getSSODetectedIdFromDecryptedToken(tokenSet.access_token);
          printDebugLog("SSODetectedId", SSODetectedId);
          res.writeHead(301, {
            Location: "/",
            "Set-Cookie": [`accessTokenCookie=${encryptedTokenSet.encryptedAccessToken}`, "isActiveSession=true", `refreshTokenCookie=${encryptedTokenSet.encryptedRefreshToken}`, `SSOUserId = ${payload.sub}`, `SSODetectedId = ${SSODetectedId}`, `loginContextCookie=; Max-Age=0`],
            "Cache-Control": "no-store, no-cache, must-revalidate, post-check=0, pre-check=0"
          });
          res.end();
        })
      });
    });
  }

  function logout(res) {
    const urlModule = require("url");
    const logoutUrl = urlModule.parse(oauthConfig.client.logoutUrl);

    logoutUrl.query = {
      post_logout_redirect_uri: oauthConfig.client.postLogoutRedirectUrl,
      client_id: oauthConfig.client.clientId,
    };
    res.writeHead(301, {
      Location: urlModule.format(logoutUrl),
      "Set-Cookie": `sessionExpiryTime=; Path=/`
    });
    res.end();
  }


  function printDebugLog(...args) {
    if (oauthConfig.debugLogEnabled) {
      logger.debug(...args);
    }
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
      res.writeHead(301, {
        Location: "/logout",
        "Set-Cookie": ["accessTokenCookie=; Max-Age=0", "isActiveSession=; Max-Age=0", "refreshTokenCookie=; Max-Age=0", "loginContextCookie=; Max-Age=0"],
        "Cache-Control": "no-store, no-cache, must-revalidate, post-check=0, pre-check=0"
      });
      res.end();
    }

    function isLogoutPhaseActive() {
      return url === "/logout";
    }

    const canSkipOAuth = urlsToSkip.some((urlToSkip) => url.indexOf(urlToSkip) === 0);
    if (canSkipOAuth) {
      next();
      return;
    }

    if (!config.getConfig("enableLocalhostAuthorization") && req.headers.host.indexOf("localhost") === 0) {
      next();
      return;
    }

    //this if is meant to help debugging "special" situation of wrong localhost req being checked with sso even if localhostAuthorization is disabled
    if (!config.getConfig("enableLocalhostAuthorization") && req.headers.host.indexOf("localhost") !== -1){
      logger.debug("SSO verification activated on 'local' request", "host header", req.headers.headers.host, JSON.stringify(req.headers));
    }

    if (isCallbackPhaseActive()) {
      return loginCallbackRoute(req, res);
    }

    if (isLogoutPhaseActive()) {
      return logout(res);
    }

    if (isPostLogoutPhaseActive()) {
      return startAuthFlow(req, res);
    }

    let {accessTokenCookie, refreshTokenCookie, isActiveSession} = util.parseCookies(req.headers.cookie);

    if (!accessTokenCookie) {
      if (!isActiveSession) {
        printDebugLog("Redirect to start authentication flow because accessTokenCookie and isActiveSession are missing.")
        return startAuthFlow(req, res);
      } else {
        printDebugLog("Logout because accessTokenCookie is missing and isActiveSession is present.")
        return startLogoutPhase(res);
      }
    }

    const jwksEndpoint = config.getConfig("oauthJWKSEndpoint");
    util.validateEncryptedAccessToken(jwksEndpoint, accessTokenCookie, oauthConfig.sessionTimeout, (err) => {
      if (err) {
        if (err.message === errorMessages.ACCESS_TOKEN_DECRYPTION_FAILED || err.message === errorMessages.SESSION_EXPIRED) {
          printDebugLog("Logout because accessTokenCookie decryption failed or session has expired.")
          return startLogoutPhase(res);
        }

        return webClient.refreshToken(refreshTokenCookie, (err, tokenSet) => {
          if (err) {
            if (err.message === errorMessages.REFRESH_TOKEN_DECRYPTION_FAILED || err.message === errorMessages.SESSION_EXPIRED) {
              printDebugLog("Logout because refreshTokenCookie decryption failed or session has expired.")
              return startLogoutPhase(res);
            }
            return sendUnauthorizedResponse(req, res, "Unable to refresh token");
          }

          const cookies = [`accessTokenCookie=${tokenSet.encryptedAccessToken}`, `refreshTokenCookie=${tokenSet.encryptedRefreshToken}`];
          res.writeHead(301, {Location: "/", "Set-Cookie": cookies});
          res.end();
        })
      }

      util.getSSODetectedIdFromEncryptedToken(accessTokenCookie, (err, SSODetectedId)=>{
        if (err) {
            printDebugLog("Logout because accessTokenCookie decryption failed or session has expired.")
            return startLogoutPhase(res);
        }

        printDebugLog("SSODetectedId", SSODetectedId);
        req.headers["user-id"] = SSODetectedId;
        if (url.includes("/mq/")) {
          return next();
        }
        util.updateAccessTokenExpiration(accessTokenCookie, (err, encryptedAccessToken)=>{
          if (err) {
            printDebugLog("Logout because accessTokenCookie decryption failed.")
            return startLogoutPhase(res);
          }

          const sessionExpiryTime = Date.now() + oauthConfig.sessionTimeout;
          const cookies = [`sessionExpiryTime=${sessionExpiryTime}; Path=/`, `accessTokenCookie=${encryptedAccessToken}; Path=/`]
          res.setHeader("Set-Cookie", cookies);
          next();
        })
      })
    })
  });
}

module.exports = OAuthMiddleware;
