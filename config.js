// config.js

module.exports = {
    mongodb: {
      // Connection URI obtained from Azure Cosmos DB
      uri: 'mongodb+srv://merntest:Indian123*@mern.mongocluster.cosmos.azure.com/?tls=true&authMechanism=SCRAM-SHA-256&retrywrites=false&maxIdleTimeMS=120000',
      
      // Other configuration options if needed
      options: {
        useNewUrlParser: true,
        useUnifiedTopology: true
      }
    }
  };
  