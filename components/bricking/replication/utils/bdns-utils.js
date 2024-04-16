async function getValidatorsForCurrentDomain(executionEngine) {
    const {contracts} = executionEngine;
    const domainInfo = await $$.promisify(contracts.bdns.getDomainInfo.bind(contracts.bdns))();
    return domainInfo.validators;
}

module.exports = {
    getValidatorsForCurrentDomain,
};