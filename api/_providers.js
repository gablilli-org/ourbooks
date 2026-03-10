export const PROVIDERS = [
  {
    id: "hubscuola",
    name: "HubScuola",
    description: "Mondadori Education / HubScuola",
    params: ["platform", "volumeId", "token"]
  },
  {
    id: "zanichelli",
    name: "Zanichelli (BookTab)",
    description: "Zanichelli BookTab",
    params: ["username", "password", "isbn", "booktab-isbn"]
  },
  {
    id: "sanoma",
    name: "Sanoma",
    description: "Sanoma Italia",
    params: ["id", "password", "gedi"]
  },
  {
    id: "dibooklaterza",
    name: "Laterza (DiBook)",
    description: "Laterza DiBook",
    params: ["jwt", "isbn"]
  },
  {
    id: "bsmart",
    name: "bSmart",
    description: "bSmart",
    params: ["username", "password"]
  }
];

export const PROVIDER_IDS = PROVIDERS.map(p => p.id);
