/** Configuration errors should name the missing variable, not fail deep in a client library. */
export class MissingConfigError extends Error {
  constructor(name, hint) {
    super(`${name} is not set. ${hint} See .env.example.`);
    this.name = "MissingConfigError";
    this.variable = name;
  }
}

export function requireEnv(name, hint) {
  const value = process.env[name];
  if (!value) throw new MissingConfigError(name, hint);
  return value;
}
