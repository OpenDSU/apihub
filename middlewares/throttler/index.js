const TokenBucket = require("../../http-wrapper/src/TokenBucket");

function Throttler(server) {
    const logger = $$.getLogger("Throttler", "apihub");
    const START_TOKENS = 6000000;
    const tokenBucket = new TokenBucket(START_TOKENS, 1, 10);
    let remainingTokens = START_TOKENS;
    const conf = require('../../http-wrapper/config').getConfig();

    function throttlerHandler(req, res, next) {
        const ip = res.socket.remoteAddress;
        tokenBucket.takeToken(ip, tokenBucket.COST_MEDIUM, function (err, remainedTokens) {
            res.setHeader('X-RateLimit-Limit', tokenBucket.getLimitByCost(tokenBucket.COST_MEDIUM));
            res.setHeader('X-RateLimit-Remaining', tokenBucket.getRemainingTokenByCost(remainedTokens, tokenBucket.COST_MEDIUM));
            remainingTokens = remainedTokens;
            if (err) {
                if (err === TokenBucket.ERROR_LIMIT_EXCEEDED) {
                    res.statusCode = 429;
                } else {
                    res.statusCode = 500;
                }

                res.end();
                return;
            }

            next();
        });
    }

    function readyProbeHandler(req, res) {
        const stats = {
            remainingTokens: tokenBucket.getRemainingTokenByCost(remainingTokens, tokenBucket.COST_MEDIUM),
            tokenLimit: tokenBucket.getLimitByCost(tokenBucket.COST_MEDIUM)
        }

        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.write(JSON.stringify(stats));
        res.end();
    }

    if (conf.preventRateLimit !== true) {
        server.use(throttlerHandler);
        server.get("/ready-probe", readyProbeHandler);
    } else {
        logger.debug(`Rate limit mechanism disabled!`);
        server.get("/ready-probe", function (req, res) {
            res.statusCode = 200;
            res.write("Server ready");
            res.end();
        });
    }
}

module.exports = Throttler;