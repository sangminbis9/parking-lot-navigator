await import("dotenv/config");

const { createCompositeParkingProvider } = await import("../src/providers/createProviders.js");

const provider = createCompositeParkingProvider();
console.log(JSON.stringify({ providers: provider.health(), generatedAt: new Date().toISOString() }, null, 2));
