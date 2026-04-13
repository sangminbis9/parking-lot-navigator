import { createCompositeParkingProvider } from "../src/providers/createProviders.js";

const provider = createCompositeParkingProvider();
console.log(JSON.stringify({ providers: provider.health(), generatedAt: new Date().toISOString() }, null, 2));
