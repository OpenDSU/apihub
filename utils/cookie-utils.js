const COOKIE_REGEX = /([^;=\s]*)=([^;]*)/g;

function parseCookies(str) {
    let cookies = {};
    if (!str) {
        return cookies;
    }
    for (let m; (m = COOKIE_REGEX.exec(str));) {
        cookies[m[1]] = decodeURIComponent(m[2]);
    }
    return cookies;
}

/**
 * @param {Object} options
 * @param {string} [options.name='']
 * @param {string} [options.value='']
 * @param {Date} [options.expires]
 * @param {number} [options.maxAge]
 * @param {string} [options.domain]
 * @param {string} [options.path]
 * @param {boolean} [options.secure]
 * @param {boolean} [options.httpOnly]
 * @param {'Strict'|'Lax'|'None'} [options.sameSite]
 * @return {string}
 */
function createSetCookieEntry(options) {
    return (
        `${options.name || ""}=${encodeURIComponent(options.value || "")}` +
        (options.expires != null ? `; Expires=${options.expires.toUTCString()}` : "") +
        (options.maxAge != null ? `; Max-Age=${options.maxAge}` : "") +
        (options.domain != null ? `; Domain=${options.domain}` : "") +
        (options.path != null ? `; Path=${options.path}` : "") +
        (options.secure ? "; Secure" : "") +
        (options.httpOnly ? "; HttpOnly" : "") +
        (options.sameSite != null ? `; SameSite=${options.sameSite}` : "")
    );
}

function stringifyCookies(cookies) {
    if (!Array.isArray(cookies)) {
        cookies = [cookies];
    }

    return cookies.map(createSetCookieEntry).join("; ");
}

module.exports = {
    parseCookies,
    stringifyCookies,
};
