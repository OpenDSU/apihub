function CreditManagerClient() {
    const openDSU = require("opendsu");
    const http = openDSU.loadAPI("http");
    const system = openDSU.loadAPI("system");
    const baseUrl = system.getBaseURL();
    const endpoint = `${baseUrl}/credit-manager/executeCommand`;
    this.__executeCommand = async (asUser, commandName, args) => {
        args = args || [];

        const command = {
            commandName: commandName,
            asUser: asUser,
            args: args
        };

        try {
            const response = await http.fetch(endpoint, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(command)
            });

            // Handle unsuccessful responses
            if (!response.ok) {
                const errorMessage = await response.text();
                throw new Error('Command execution failed: ' + errorMessage);
            }

            return await response.text();
        } catch (error) {
            throw new Error('Failed to execute command: ' + error.message);
        }
    }
}

module.exports = CreditManagerClient;