function AuthenticationPlugin() {
    const sessionUserMap = new Map()

    this.createUser = async function (email, name) {
        const sessionId = generateId(16);
        sessionUserMap.set(sessionId, email);
        return sessionId;
    }

    this.getUser = async function (sessionId) {
        return sessionUserMap.get(sessionId);
    }

    this.deleteUser = async function (sessionId) {
        sessionUserMap.delete(sessionId);
    }

    this.checkSession = async function (sessionId) {
        return sessionUserMap.has(sessionId);
    }

    this.checkUserExists = async function (email) {
        for (const [sessionId, user] of sessionUserMap.entries()) {
            if (user === email) {
                return true;
            }
        }
        return false;
    }
}
    
module.exports = AuthenticationPlugin;