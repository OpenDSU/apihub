const HASH_MAX_SIZE = process.env.FOLDER_NAME_SIZE || 5;

function verifyBrickHash(brickHash) {
    if (!brickHash || typeof brickHash !== 'string') {
        throw Error('[Bricking] No hash specified');
    }

    if (brickHash.length < HASH_MAX_SIZE) {
        throw Error(`[Bricking] Hash "${brickHash}" is too small`);
    }
}

module.exports = {
    HASH_MAX_SIZE,
    verifyBrickHash
}